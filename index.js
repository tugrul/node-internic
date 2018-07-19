
const servers = require('./servers.json');
const net = require('net');
const readline = require('readline');

const regex = {
    property: /^ {3}(.+): (.+)$/,
    lastUpdate: /^>>> Last update of whois database: (.+) <<<$/,
    noMatchFor: /^No match for "([^"]+)"\.$/
};

function getWhoisInfo(server, domain) {

    return new Promise((resolve, reject) => {

        const startTime = Date.now();
        let connectDelay = 0;

        const client = net.connect(43, server, () => {
            connectDelay = Date.now() - startTime;
            client.write(domain + '\n', 'ascii');
        });

        client.setTimeout(5000);

        client.on('error', reject);
        client.on('timeout', () => {
            client.destroy(new Error('Network Connect Timeout for ' + server));
        })

        const reader = readline.createInterface({
            input: client,
            crlfDelay: Infinity
        });

        const lines = [];

        reader.on('line', (line) => {

            if (line.length === 0) {
                return lines.push({
                    type: 'empty'
                });
            }

            if (regex.noMatchFor.test(line)) {
                return resolve({
                    available: true,
                    server: server,
                    timing: {
                        connect: connectDelay,
                        end: Date.now() - startTime
                    }
                });
            }

            const property = regex.property.exec(line);

            if (property) {
                return lines.push({
                    type: 'property',
                    label: property[1],
                    value: property[2]});
            }

            const lastUpdate = regex.lastUpdate.exec(line);

            if (lastUpdate) {
                return lines.push({
                    type: 'lastUpdate',
                    value: lastUpdate[1]
                });
            }

            lines.push({
                type: 'text',
                value: line
            });

        });

        reader.on('close', () => {

            let prev = 'empty';
            let text = [];
            let section = {};

            const data = {
                lastUpdate: null,
                sections: [],
                texts: []
            };

            lines.forEach((line) => {

                if (line.type === 'empty') {
                    switch (prev) {
                        case 'property': data.sections.push(section); section = {}; break;
                        case 'text': data.texts.push(text.join(' ')); text = []; break;
                    }

                    return prev = 'empty';
                }

                if (line.type === 'lastUpdate') {
                    data.lastUpdate = line.value;

                    switch (prev) {
                        case 'property': data.sections.push(section); section = {}; break;
                        case 'text': data.texts.push(text.join(' ')); text = []; break;
                    }

                    return prev = 'lastUpdate';
                }

                if (line.type === 'property') {
                    prev = 'property';

                    if (!section[line.label]) {
                        return section[line.label] = line.value;
                    }

                    if (typeof section[line.label] === 'string') {
                        return section[line.label] = [section[line.label], line.value];
                    }

                    return section[line.label].push(line.value);
                }

                if (line.type === 'text') {
                    prev = 'text';

                    text.push(line.value);
                }

            });

            resolve({
                available: false,
                server: server,
                data: data,
                timing: {
                    connect: connectDelay,
                    end: Date.now() - startTime
                }
            });

        });

    });

};

function getWhoisInfoAll(domain) {

    return Promise.all(Object.keys(servers)
        .map(name => getWhoisInfo(servers[name].ip, domain)));

}

exports.servers = servers;
exports.getWhoisInfo = getWhoisInfo;
exports.getWhoisInfoAll = getWhoisInfoAll;

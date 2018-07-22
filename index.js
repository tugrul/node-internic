
const servers = require('./servers.json');
const net = require('net');
const readline = require('readline');

const regex = {
    property: /^ {3}(.+):(?: (.+))?$/,
    lastUpdate: /^>>> Last update of whois database: (.+) <<<$/,
    noMatchFor: /^No match for "([^"]+)"\.$/
};

function Internic({server = 'whois.verisign-grs.com', timeout = 3000, testQuery = 'example.com'} = {}) {

    this.server = server;
    this.timeout = timeout;
    this.testQuery = testQuery;

}

Internic.prototype._getReader = function _getReader(domain, {server = this.server, timeout = this.timeout} = {}) {


    if (typeof server !== 'string' && server instanceof Array) {
        server = server[Math.round(Math.random() * (server.length - 1))];
    }

    const startTime = Date.now();

    const client = net.connect(43, server, () => {

        reader.connectDelay = Date.now() - startTime;
        reader.startTime = startTime;
        reader.targetServer = server;

        client.write(domain + '\n', 'ascii');
    });

    client.setTimeout(timeout);

    client.on('timeout', () => {
        client.destroy(new Error('Network Connect Timeout for ' + server));
    })

    const reader = readline.createInterface({
        input: client,
        crlfDelay: Infinity
    });


    return {client, reader};
};

Internic.prototype.isDomainAvailable = function isDomainAvailable(domain, options) {

    return new Promise((resolve, reject) => {

        let isResolved = false;

        const {client, reader} = this._getReader(domain, options);

        client.on('error', reject);

        reader.on('line', (line) => {

            if (regex.noMatchFor.test(line)) {

                isResolved = true;

                return resolve({
                    domain: domain,
                    available: true,
                    server: reader.targetServer,
                    timing: {
                        connect: reader.connectDelay,
                        end: Date.now() - reader.startTime
                    }
                });
            }

        });

        reader.on('close', () => {

            return isResolved || resolve({
                domain: domain,
                available: false,
                server: reader.targetServer,
                timing: {
                    connect: reader.connectDelay,
                    end: Date.now() - reader.startTime
                }
            });

        });

    });
};

Internic.prototype.getWhoisInfo = function getWhoisInfo(domain, options) {

    return new Promise((resolve, reject) => {

        const {client, reader} = this._getReader(domain, options);

        client.on('error', reject);

        const lines = [];

        reader.on('line', (line) => {

            if (line.length === 0) {
                return lines.push({
                    type: 'empty'
                });
            }

            if (regex.noMatchFor.test(line)) {
                return lines.push({type: 'status', value: true});

            }

            const property = regex.property.exec(line);

            if (property) {
                return lines.push({
                    type: 'property',
                    label: property[1],
                    value: property[2] || null});
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
                available: false,
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

                if (line.type === 'status') {
                    data.available = line.value;
                    return prev = 'status';
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
                domain: domain,
                server: reader.targetServer,
                data: data,
                timing: {
                    connect: reader.connectDelay,
                    end: Date.now() - reader.startTime
                }
            });

        });

    });

};

Internic.prototype.getWhoisInfoAll = function getWhoisInfoAll(domain, timeout) {

    return Promise.all(Object.keys(servers)
        .map(name => this.getWhoisInfo(domain, {server: servers[name].ip, timeout: timeout || this.timeout})));

};

Internic.prototype.getBestServer = function getBestServer(count, timing) {
    return this.getWhoisInfoAll(this.testQuery, 10000).then(results => {

        const sorted = results.sort((left, right) =>
            (left.timing.end - left.timing.connect)
            - (right.timing.end - right.timing.connect));

        if (count && count > 1) {
            return sorted.slice(0, count).map(item => timing ? {server: item.server, timing: item.timing} : item.server);
        }

        const result = sorted.shift();
        return timing ? {server: result.server, timing: result.timing} : result.server;

    });
};

const internic = module.exports = new Internic();

internic.servers = servers;
internic.defaults = options => new Internic(options);



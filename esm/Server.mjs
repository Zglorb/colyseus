import http from 'http';
import net from 'net';
import WebSocket from 'ws';
import { debugAndPrintError, debugMatchMaking } from './Debug.mjs';
import * as MatchMaker from './MatchMaker.mjs';
import { setup, defineRoomType, gracefullyShutdown, query } from './MatchMaker.mjs';
import { Room } from './Room.mjs';
import { generateId, registerGracefulShutdown } from './Utils.mjs';
import '@gamestdio/timer';
import { registerNode, unregisterNode } from './discovery/index.mjs';
import { LocalPresence } from './presence/LocalPresence.mjs';
import { ServerError } from './errors/ServerError.mjs';
import { ErrorCode } from './Protocol.mjs';
import { TCPTransport } from './transport/TCP/TCPTransport.mjs';
import { WebSocketTransport } from './transport/WebSocket/WebSocketTransport.mjs';
import 'events';
import 'redis';
import 'util';
import '@colyseus/schema';
import 'fossil-delta';
import 'notepack.io';
import 'fast-json-patch';
import './transport/Transport.mjs';
import 'nonenumerable';
import './rooms/RelayRoom.mjs';

class Server {
    constructor(options = {}) {
        this.processId = generateId();
        this.matchmakeRoute = 'matchmake';
        this.exposedMethods = ['joinOrCreate', 'create', 'join', 'joinById'];
        this.allowedRoomNameChars = /([a-zA-Z_\-0-9]+)/gi;
        this.onShutdownCallback = () => Promise.resolve();
        const { gracefullyShutdown = true } = options;
        this.presence = options.presence || new LocalPresence();
        // setup matchmaker
        setup(this.presence, options.driver, this.processId);
        // "presence" option is not used from now on
        delete options.presence;
        this.attach(options);
        if (gracefullyShutdown) {
            registerGracefulShutdown((err) => this.gracefullyShutdown(true, err));
        }
    }
    attach(options) {
        if (!options.server) {
            options.server = http.createServer();
        }
        options.server.once('listening', () => this.registerProcessForDiscovery());
        this.attachMatchMakingRoutes(options.server);
        const engine = options.engine || WebSocket.Server;
        delete options.engine;
        this.transport = (engine === net.Server)
            ? new TCPTransport(options)
            : new WebSocketTransport(options, engine);
    }
    /**
     * Bind the server into the port specified.
     *
     * @param port
     * @param hostname
     * @param backlog
     * @param listeningListener
     */
    async listen(port, hostname, backlog, listeningListener) {
        return new Promise((resolve, reject) => {
            this.transport.listen(port, hostname, backlog, (err) => {
                if (listeningListener) {
                    listeningListener(err);
                }
                if (err) {
                    reject();
                }
                else {
                    resolve();
                }
            });
        });
    }
    registerProcessForDiscovery() {
        // register node for proxy/service discovery
        registerNode(this.presence, {
            port: this.transport.address().port,
            processId: this.processId,
        });
    }
    /**
     * Define a new type of room for matchmaking.
     *
     * @param name public room identifier for match-making.
     * @param handler Room class definition
     * @param defaultOptions default options for `onCreate`
     */
    define(name, handler, defaultOptions) {
        return defineRoomType(name, handler, defaultOptions);
    }
    async gracefullyShutdown(exit = true, err) {
        await unregisterNode(this.presence, {
            port: this.transport.address().port,
            processId: this.processId,
        });
        try {
            await gracefullyShutdown();
            this.transport.shutdown();
            await this.onShutdownCallback();
        }
        catch (e) {
            debugAndPrintError(`error during shutdown: ${e}`);
        }
        finally {
            if (exit) {
                process.exit(err ? 1 : 0);
            }
        }
    }
    /**
     * Add simulated latency between client and server.
     * @param milliseconds round trip latency in milliseconds.
     */
    simulateLatency(milliseconds) {
        console.warn(`Colyseus latency simulation enabled → ${milliseconds}ms latency for round trip.`);
        const halfwayMS = (milliseconds / 2);
        this.transport.simulateLatency(halfwayMS);
        /* tslint:disable:no-string-literal */
        const _onMessage = Room.prototype['_onMessage'];
        /* tslint:disable:no-string-literal */
        Room.prototype['_onMessage'] = function (...args) {
            setTimeout(() => _onMessage.apply(this, args), halfwayMS);
        };
    }
    /**
     * Register a callback that is going to be executed before the server shuts down.
     * @param callback
     */
    onShutdown(callback) {
        this.onShutdownCallback = callback;
    }
    attachMatchMakingRoutes(server) {
        const listeners = server.listeners('request').slice(0);
        server.removeAllListeners('request');
        server.on('request', (req, res) => {
            if (req.url.indexOf(`/${this.matchmakeRoute}`) !== -1) {
                debugMatchMaking('received matchmake request: %s', req.url);
                this.handleMatchMakeRequest(req, res);
            }
            else {
                for (let i = 0, l = listeners.length; i < l; i++) {
                    listeners[i].call(server, req, res);
                }
            }
        });
    }
    async handleMatchMakeRequest(req, res) {
        const headers = {
            'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept',
            'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Max-Age': 2592000,
        };
        if (req.method === 'OPTIONS') {
            res.writeHead(204, headers);
            res.end();
        }
        else if (req.method === 'POST') {
            const matchedParams = req.url.match(this.allowedRoomNameChars);
            const matchmakeIndex = matchedParams.indexOf(this.matchmakeRoute);
            const method = matchedParams[matchmakeIndex + 1];
            const name = matchedParams[matchmakeIndex + 2] || '';
            const data = [];
            req.on('data', (chunk) => data.push(chunk));
            req.on('end', async () => {
                headers['Content-Type'] = 'application/json';
                res.writeHead(200, headers);
                const body = JSON.parse(Buffer.concat(data).toString());
                try {
                    if (this.exposedMethods.indexOf(method) === -1) {
                        throw new ServerError(ErrorCode.MATCHMAKE_NO_HANDLER, `invalid method "${method}"`);
                    }
                    const response = await MatchMaker[method](name, body);
                    res.write(JSON.stringify(response));
                }
                catch (e) {
                    res.write(JSON.stringify({
                        code: e.code || ErrorCode.MATCHMAKE_UNHANDLED,
                        error: e.message,
                    }));
                }
                res.end();
            });
        }
        else if (req.method === 'GET') {
            const matchedParams = req.url.match(this.allowedRoomNameChars);
            const roomName = matchedParams[matchedParams.length - 1];
            /**
             * list public & unlocked rooms
             */
            const conditions = {
                locked: false,
                private: false,
            };
            // TODO: improve me, "matchmake" room names aren't allowed this way.
            if (roomName !== this.matchmakeRoute) {
                conditions.name = roomName;
            }
            headers['Content-Type'] = 'application/json';
            res.writeHead(200, headers);
            res.write(JSON.stringify(await query(conditions)));
            res.end();
        }
    }
}

export { Server };
//# sourceMappingURL=Server.mjs.map

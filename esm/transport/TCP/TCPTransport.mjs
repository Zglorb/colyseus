import { createServer } from 'net';
import '@gamestdio/timer';
import 'http';
import 'ws';
import { debugError, debugAndPrintError } from '../../Debug.mjs';
import { getRoomById } from '../../MatchMaker.mjs';
import '../../Room.mjs';
import { generateId } from '../../Utils.mjs';
import 'internal-ip';
import 'events';
import { Protocol } from '../../Protocol.mjs';
import { Transport } from '../Transport.mjs';
import 'querystring';
import 'url';
import '@colyseus/schema';
import 'redis';
import 'util';
import 'fossil-delta';
import 'notepack.io';
import 'fast-json-patch';
import 'nonenumerable';
import '../../rooms/RelayRoom.mjs';

/**
 * TODO:
 * TCPTransport is not working.
 * It was meant to be used for https://github.com/colyseus/colyseus-gml
 */
class TCPTransport extends Transport {
    constructor(options = {}) {
        super();
        this.server = createServer();
        this.server.on('connection', this.onConnection);
    }
    listen(port, hostname, backlog, listeningListener) {
        this.server.listen(port, hostname, backlog, listeningListener);
        return this;
    }
    shutdown() {
        this.server.close();
    }
    simulateLatency(milliseconds) {
        throw new Error('not implemented.');
    }
    onConnection(client) {
        // compatibility with ws / uws
        const upgradeReq = {};
        // set client id
        client.id = generateId();
        client.pingCount = 0;
        // set client options
        client.options = upgradeReq.options;
        client.auth = upgradeReq.auth;
        // prevent server crashes if a single client had unexpected error
        client.on('error', (err) => debugError(err.message + '\n' + err.stack));
        // client.on('pong', heartbeat);
        // client.on('data', (data) => this.onMessage(client, decode(data)));
    }
    async onMessage(client, message) {
        console.log('RECEIVED:', message);
        if (message[0] === Protocol.JOIN_ROOM) {
            const roomId = message[1];
            const sessionId = message[2];
            client.id = sessionId;
            client.sessionId = sessionId;
            console.log('EFFECTIVELY CONNECT INTO ROOM', roomId, client.id, client.options);
            client.removeAllListeners('data');
            // forward as 'message' all 'data' messages
            client.on('data', (data) => client.emit('message', data));
            const room = getRoomById(roomId);
            try {
                if (!room || !room.hasReservedSeat(sessionId)) {
                    throw new Error('seat reservation expired.');
                }
                await room._onJoin(client);
            }
            catch (e) {
                debugAndPrintError(e);
                // send[Protocol.ERROR](client, (e && e.message) || '');
                client.close(Protocol.WS_CLOSE_WITH_ERROR);
            }
        }
    }
}

export { TCPTransport };
//# sourceMappingURL=TCPTransport.mjs.map

import nanoid from 'nanoid';
import { debugAndPrintError } from './Debug.mjs';

// remote room call timeouts
const REMOTE_ROOM_SHORT_TIMEOUT = Number(process.env.COLYSEUS_PRESENCE_SHORT_TIMEOUT || 2000);
function generateId(length = 9) {
    return nanoid(length);
}
//
// nodemon sends SIGUSR2 before reloading
// (https://github.com/remy/nodemon#controlling-shutdown-of-your-script)
//
const signals = ['SIGINT', 'SIGTERM', 'SIGUSR2'];
function registerGracefulShutdown(callback) {
    /**
     * Gracefully shutdown on uncaught errors
     */
    process.on('uncaughtException', (err) => {
        debugAndPrintError(err);
        callback(err);
    });
    signals.forEach((signal) => process.once(signal, () => callback()));
}
function retry(cb, maxRetries = 3, errorWhiteList = [], retries = 0) {
    return new Promise((resolve, reject) => {
        cb()
            .then(resolve)
            .catch((e) => {
            if (errorWhiteList.indexOf(e.constructor) !== -1 &&
                retries++ < maxRetries) {
                setTimeout(() => {
                    retry(cb, maxRetries, errorWhiteList, retries).
                        then(resolve).
                        catch((e2) => reject(e2));
                }, Math.floor(Math.random() * Math.pow(2, retries) * 400));
            }
            else {
                reject(e);
            }
        });
    });
}
class Deferred {
    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
    then(func) {
        return this.promise.then.apply(this.promise, arguments);
    }
    catch(func) {
        return this.promise.catch(func);
    }
}
function spliceOne(arr, index) {
    // manually splice availableRooms array
    // http://jsperf.com/manual-splice
    if (index === -1 || index >= arr.length) {
        return false;
    }
    const len = arr.length - 1;
    for (let i = index; i < len; i++) {
        arr[i] = arr[i + 1];
    }
    arr.length = len;
    return true;
}
function merge(a, ...objs) {
    for (let i = 0, len = objs.length; i < len; i++) {
        const b = objs[i];
        for (const key in b) {
            if (b.hasOwnProperty(key)) {
                a[key] = b[key];
            }
        }
    }
    return a;
}

export { Deferred, REMOTE_ROOM_SHORT_TIMEOUT, generateId, merge, registerGracefulShutdown, retry, spliceOne };
//# sourceMappingURL=Utils.mjs.map

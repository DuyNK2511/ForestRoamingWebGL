class ReliableMessageBridge {
    constructor(sendCallback) {
        this.sendCallback = sendCallback;
        this.sendQueue = new Map();
        this.receiveBuffer = new Map();
        this.receiveQueue = [];

        this.nextSendId = 0;
        this.expectedReceiveId = 0;
        this.acked = new Set();
        this.sendTimers = new Map();

        this.maxId = 256;
    }

    send(type, data) {
        const msg = { id: this.nextSendId, type, data };
        this.sendQueue.set(msg.id, msg);
        this._sendMessage(msg);
        this.nextSendId = (this.nextSendId + 1) % this.maxId;
    }

    _sendMessage(msg) {
        if (window.webkit?.messageHandlers?.iosBridge) {
            window.webkit.messageHandlers.iosBridge.postMessage(msg);
        }

        if (this.sendTimers.has(msg.id)) {
            clearTimeout(this.sendTimers.get(msg.id));
        }

        this.sendTimers.set(
            msg.id,
            setTimeout(() => {
                if (!this.acked.has(msg.id)) {
                    console.log("Resending message", msg.id);
                    this._sendMessage(msg);
                }
            }, 1000)
        );
    }

    receiveFromNative(json) {
        if (json.ack !== undefined) {
            this._handleAck(json.ack);
        } else if (json.id !== undefined && json.type && json.data !== undefined) {
            this._handleIncomingMessage(json);

            //immediately process the message after receive it
            const latestMsg = this.receiveQueue[this.receiveQueue.length - 1];
            if (window.unityInstance && latestMsg) {
                window.unityInstance.SendMessage(
                    "MessageReceiver",
                    "HandleMessageFromBridge",
                    JSON.stringify(latestMsg)
                );
            }
        }
    }


    _handleAck(id) {
        console.log("ACK received:", id);
        this.acked.add(id);
        this.sendQueue.delete(id);
        if (this.sendTimers.has(id)) {
            clearTimeout(this.sendTimers.get(id));
            this.sendTimers.delete(id);
        }
    }

    _handleIncomingMessage(msg) {
        const id = msg.id;
        const isExpected = ((id - this.expectedReceiveId + this.maxId) % this.maxId) < (this.maxId / 2);

        if (!isExpected) {
            this._sendAck(id);
            return;
        }

        this._sendAck(id);

        if (id === this.expectedReceiveId) {
            this.receiveQueue.push(msg);
            this.expectedReceiveId = (this.expectedReceiveId + 1) % this.maxId;

            while (this.receiveBuffer.has(this.expectedReceiveId)) {
                this.receiveQueue.push(this.receiveBuffer.get(this.expectedReceiveId));
                this.receiveBuffer.delete(this.expectedReceiveId);
                this.expectedReceiveId = (this.expectedReceiveId + 1) % this.maxId;
            }
        } else {
            this.receiveBuffer.set(id, msg);
        }
    }

    _sendAck(id) {
        if (this.sendCallback) {
            this.sendCallback({ ack: id });
        }
    }

    dequeueMessage() {
        return this.receiveQueue.length > 0 ? this.receiveQueue.shift() : null;
    }
}

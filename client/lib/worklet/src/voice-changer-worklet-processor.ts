export const RequestType = {
    voice: "voice",
    config: "config",
    start: "start",
    stop: "stop",
    trancateBuffer: "trancateBuffer",
} as const;
export type RequestType = (typeof RequestType)[keyof typeof RequestType];

export const ResponseType = {
    volume: "volume",
    inputData: "inputData",
    start_ok: "start_ok",
    stop_ok: "stop_ok",
} as const;
export type ResponseType = (typeof ResponseType)[keyof typeof ResponseType];

export type VoiceChangerWorkletProcessorRequest = {
    requestType: RequestType;
    voice: Float32Array;
    numTrancateTreshold: number;
    volTrancateThreshold: number;
    volTrancateLength: number;
};

export type VoiceChangerWorkletProcessorResponse = {
    responseType: ResponseType;
    volume?: number;
    recordData?: Float32Array[];
    inputData?: Float32Array;
};

class VoiceChangerWorkletProcessor extends AudioWorkletProcessor {
    private BLOCK_SIZE = 128;
    private initialized = false;
    private volume = 0;
    // private numTrancateTreshold = 100;
    // private volTrancateThreshold = 0.0005
    // private volTrancateLength = 32
    // private volTrancateCount = 0

    private isRecording = false;

    playBuffer: Float32Array[] = [];
    unpushedF32Data: Float32Array = new Float32Array(0);
    /**
     * @constructor
     */
    constructor() {
        super();
        console.log("[AudioWorkletProcessor] created.");
        this.initialized = true;
        this.port.onmessage = this.handleMessage.bind(this);
    }

    calcVol = (data: Float32Array, prevVol: number) => {
        const sum = data.reduce((prev, cur) => {
            return prev + cur * cur;
        }, 0);
        const rms = Math.sqrt(sum / data.length);
        return Math.max(rms, prevVol * 0.95);
    };

    trancateBuffer = () => {
        console.log("[worklet] Buffer truncated");
        while (this.playBuffer.length > 2) {
            this.playBuffer.shift();
        }
    };
    handleMessage(event: any) {
        const request = event.data as VoiceChangerWorkletProcessorRequest;
        if (request.requestType === "config") {
            // this.numTrancateTreshold = request.numTrancateTreshold;
            // this.volTrancateLength = request.volTrancateLength
            // this.volTrancateThreshold = request.volTrancateThreshold
            console.log("[worklet] worklet configured", request);
            return;
        } else if (request.requestType === "start") {
            if (this.isRecording) {
                console.warn("[worklet] recoring is already started");
                return;
            }
            this.isRecording = true;
            const startResponse: VoiceChangerWorkletProcessorResponse = {
                responseType: "start_ok",
            };
            this.port.postMessage(startResponse);
            return;
        } else if (request.requestType === "stop") {
            if (!this.isRecording) {
                console.warn("[worklet] recoring is not started");
                return;
            }
            this.isRecording = false;
            const stopResponse: VoiceChangerWorkletProcessorResponse = {
                responseType: "stop_ok",
            };
            this.port.postMessage(stopResponse);
            return;
        } else if (request.requestType === "trancateBuffer") {
            this.trancateBuffer();
            return;
        }

        const f32Data = request.voice;
        // if (this.playBuffer.length > this.numTrancateTreshold) {
        //     console.log(`[worklet] Truncate ${this.playBuffer.length} > ${this.numTrancateTreshold}`);
        //     this.trancateBuffer();
        // }
        if (this.playBuffer.length > (f32Data.length / this.BLOCK_SIZE) * 1.5) {
            console.log(`[worklet] Truncate ${this.playBuffer.length} > ${f32Data.length / this.BLOCK_SIZE}`);
            this.trancateBuffer();
        }

        const concatedF32Data = new Float32Array(this.unpushedF32Data.length + f32Data.length);
        concatedF32Data.set(this.unpushedF32Data);
        concatedF32Data.set(f32Data, this.unpushedF32Data.length);

        const chunkNum = Math.floor(concatedF32Data.length / this.BLOCK_SIZE);
        for (let i = 0; i < chunkNum; i++) {
            const block = concatedF32Data.slice(i * this.BLOCK_SIZE, (i + 1) * this.BLOCK_SIZE);
            this.playBuffer.push(block);
        }
        this.unpushedF32Data = concatedF32Data.slice(chunkNum * this.BLOCK_SIZE);
    }

    pushData = (inputData: Float32Array) => {
        const volumeResponse: VoiceChangerWorkletProcessorResponse = {
            responseType: ResponseType.inputData,
            inputData: inputData,
        };
        this.port.postMessage(volumeResponse);
    };

    process(_inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>) {
        if (!this.initialized) {
            console.warn("[worklet] worklet_process not ready");
            return true;
        }

        if (this.isRecording) {
            if (_inputs.length > 0 && _inputs[0].length > 0) {
                this.pushData(_inputs[0][0]);
            }
        }

        if (this.playBuffer.length === 0) {
            // console.log("[worklet] no play buffer");
            return true;
        }
        // console.log("[worklet] play buffer");
        //// 一定期間無音状態が続いている場合はスキップ。
        // let voice: Float32Array | undefined
        // while (true) {
        //     voice = this.playBuffer.shift()
        //     if (!voice) {
        //         break
        //     }
        //     this.volume = this.calcVol(voice, this.volume)
        //     if (this.volume < this.volTrancateThreshold) {
        //         this.volTrancateCount += 1
        //     } else {
        //         this.volTrancateCount = 0
        //     }

        //     // V.1.5.0よりsilent skipで音飛びするようになったので無効化
        //     if (this.volTrancateCount < this.volTrancateLength || this.volTrancateLength < 0) {
        //         break
        //     } else {
        //         break
        //         // console.log("silent...skip")
        //     }
        // }
        let voice = this.playBuffer.shift();
        if (voice) {
            this.volume = this.calcVol(voice, this.volume);
            const volumeResponse: VoiceChangerWorkletProcessorResponse = {
                responseType: ResponseType.volume,
                volume: this.volume,
            };
            this.port.postMessage(volumeResponse);
            outputs[0][0].set(voice);
            if (outputs[0].length == 2) {
                outputs[0][1].set(voice);
            }
        }

        return true;
    }
}
registerProcessor("voice-changer-worklet-processor", VoiceChangerWorkletProcessor);

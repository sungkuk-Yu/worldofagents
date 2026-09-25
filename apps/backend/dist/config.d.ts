export declare const config: {
    port: number;
    host: string;
    devMode: boolean;
    cors: {
        origin: string[];
    };
    supabase: {
        url: string;
        anonKey: string;
        serviceKey: string;
    };
    streamChat: {
        apiKey: string;
        apiSecret: string;
    };
    openai: {
        apiKey: string;
        whisperModel: string;
        stt: {
            sampleRate: number;
            encoding: "pcm_s16le";
            vadThreshold: number;
            silenceBoundaryMs: number;
            partialIntervalMs: number;
        };
    };
    jwt: {
        secret: string;
        expiresIn: string;
    };
    /**
     * 뉴런 오케스트레이션 엔진 선택:
     * - 'langgraph': LangGraph StateGraph 기반 (설치/런타임 정상 시)
     * - 'simple'   : 동일 노드 로직을 순차 파이프라인으로 실행 (폴백)
     */
    neuronEngine: string;
    ws: {
        pingIntervalMs: number;
        pongTimeoutMs: number;
        maxAudioBufferMs: number;
    };
};
//# sourceMappingURL=config.d.ts.map
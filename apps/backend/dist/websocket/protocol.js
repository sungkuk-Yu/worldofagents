"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NEURON_NAMES = void 0;
exports.sendJson = sendJson;
exports.NEURON_NAMES = {
    empathy: '공감 에이뉴런',
    answer: '답변생성 에이뉴런',
    queue: '큐 에이뉴런',
    visual: '비주얼 에이뉴런',
    router: '라우터',
    grounding: '검색그라운딩',
    bridge: '비서실 브리지',
};
function sendJson(socket, message) {
    try {
        socket.send(JSON.stringify(message));
    }
    catch {
        // 소켓 닫힘 무시
    }
}
//# sourceMappingURL=protocol.js.map
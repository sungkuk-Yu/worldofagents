// 뉴런 오케스트레이터 (Neuron Orchestrator)
// 설계서: neuron-architecture-spec.md
// 에이뉴런 동적 연결/해제 및 통합 페르소나 관리
import { NeuronType, NeuronState, NeuronConnectionEvent } from '../types';

// 뉴런 레지스트리 — 활성화된 뉴런 관리
export class NeuronOrchestrator {
  private neurons: Map<NeuronType, NeuronState> = new Map();
  private eventListeners: ((event: NeuronConnectionEvent) => void)[] = [];

  constructor() {
    // 공감 에이뉴런은 상시 활성 (설계서 §2.1)
    this.neurons.set('empathy', {
      type: 'empathy',
      active: true,
      confidence: 1.0,
      processing: false,
    });
  }

  // 뉴런 활성화
  activate(type: NeuronType, reason?: string): void {
    const current = this.neurons.get(type);
    if (current?.active) return;

    this.neurons.set(type, {
      type,
      active: true,
      confidence: 0,
      processing: true,
    });

    this.emitEvent({
      type: 'activated',
      neuron: type,
      timestamp: new Date(),
      reason,
    });
  }

  // 뉴런 비활성화
  deactivate(type: NeuronType, reason?: string): void {
    const current = this.neurons.get(type);
    if (!current?.active) return;

    this.neurons.set(type, {
      ...current,
      active: false,
      processing: false,
      confidence: 0,
    });

    this.emitEvent({
      type: 'deactivated',
      neuron: type,
      timestamp: new Date(),
      reason,
    });
  }

  // 뉴런 상태 업데이트
  updateConfidence(type: NeuronType, confidence: number): void {
    const current = this.neurons.get(type);
    if (!current) return;

    this.neurons.set(type, {
      ...current,
      confidence: Math.max(0, Math.min(1, confidence)),
    });
  }

  // 뉴런 처리 완료
  completeProcessing(type: NeuronType): void {
    const current = this.neurons.get(type);
    if (!current) return;

    this.neurons.set(type, {
      ...current,
      processing: false,
    });
  }

  // 현재 활성 뉴런 목록
  getActiveNeurons(): NeuronState[] {
    return Array.from(this.neurons.values()).filter((n) => n.active);
  }

  // 모든 뉴런 상태
  getAllNeurons(): NeuronState[] {
    return Array.from(this.neurons.values());
  }

  // 특정 뉴런 상태 조회
  getNeuron(type: NeuronType): NeuronState | undefined {
    return this.neurons.get(type);
  }

  // 이벤트 리스너 등록
  onEvent(listener: (event: NeuronConnectionEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  private emitEvent(event: NeuronConnectionEvent): void {
    this.eventListeners.forEach((listener) => listener(event));
  }
}

// 싱글톤 인스턴스
export const orchestrator = new NeuronOrchestrator();

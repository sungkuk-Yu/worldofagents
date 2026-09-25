// useNeuronConnection — 뉴런 연결 상태 관리 훅
import { useState, useEffect, useCallback } from 'react';
import { NeuronState, NeuronType, NeuronConnectionEvent } from '../types';
import { orchestrator } from '../neurons/NeuronOrchestrator';

export interface UseNeuronConnectionReturn {
  neurons: NeuronState[];
  activeNeurons: NeuronState[];
  activate: (type: NeuronType, reason?: string) => void;
  deactivate: (type: NeuronType, reason?: string) => void;
  recentEvents: NeuronConnectionEvent[];
}

export function useNeuronConnection(): UseNeuronConnectionReturn {
  const [neurons, setNeurons] = useState<NeuronState[]>(orchestrator.getAllNeurons());
  const [recentEvents, setRecentEvents] = useState<NeuronConnectionEvent[]>([]);

  useEffect(() => {
    const unsubscribe = orchestrator.onEvent((event) => {
      setNeurons(orchestrator.getAllNeurons());
      setRecentEvents((prev) => [event, ...prev].slice(0, 50));
    });

    return unsubscribe;
  }, []);

  const activate = useCallback((type: NeuronType, reason?: string) => {
    orchestrator.activate(type, reason);
  }, []);

  const deactivate = useCallback((type: NeuronType, reason?: string) => {
    orchestrator.deactivate(type, reason);
  }, []);

  return {
    neurons,
    activeNeurons: neurons.filter((n) => n.active),
    activate,
    deactivate,
    recentEvents,
  };
}

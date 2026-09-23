import { useState, useEffect, useCallback } from 'react';
import { voiceService, VoiceState } from '../services/voiceService';

export function useVoiceChat() {
  const [voiceState, setVoiceState] = useState<VoiceState>(() => voiceService.getState());

  useEffect(() => {
    const unsubscribe = voiceService.subscribe((state) => {
      setVoiceState(state);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const joinVoice = useCallback(
    async (roomId: string, userId: string, name: string, avatar: string = '') => {
      return await voiceService.joinVoice(roomId, userId, name, avatar);
    },
    []
  );

  const leaveVoice = useCallback(() => {
    voiceService.leaveVoice();
  }, []);

  const toggleMicMute = useCallback(() => {
    return voiceService.toggleMicMute();
  }, []);

  const toggleDeafened = useCallback(() => {
    return voiceService.toggleDeafened();
  }, []);

  const setVoiceMode = useCallback((mode: 'vad' | 'ptt') => {
    voiceService.setVoiceMode(mode);
  }, []);

  const setPttActive = useCallback((active: boolean) => {
    voiceService.setPttActive(active);
  }, []);

  const setVadThreshold = useCallback((threshold: number) => {
    voiceService.setVadThreshold(threshold);
  }, []);

  const setMemberVolume = useCallback((userId: string, volume: number) => {
    voiceService.setMemberVolume(userId, volume);
  }, []);

  const toggleEchoTest = useCallback(() => {
    return voiceService.toggleEchoTest();
  }, []);

  const setEchoTesting = useCallback((testing: boolean) => {
    voiceService.setEchoTesting(testing);
  }, []);

  const simulatePeerVoice = useCallback((peerName?: string, avatar?: string) => {
    voiceService.simulatePeerVoice(peerName, avatar);
  }, []);

  const simulateLocalSpeech = useCallback(() => {
    voiceService.simulateLocalSpeech();
  }, []);

  return {
    ...voiceState,
    joinVoice,
    leaveVoice,
    toggleMicMute,
    toggleDeafened,
    setVoiceMode,
    setPttActive,
    setVadThreshold,
    setMemberVolume,
    toggleEchoTest,
    setEchoTesting,
    simulatePeerVoice,
    simulateLocalSpeech,
  };
}

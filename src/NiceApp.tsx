import React, { useEffect, useRef, useState } from "react";
import { loadSpeex, SpeexWorkletNode } from "@sapphi-red/web-noise-suppressor";
import speexWorkletPath from "@sapphi-red/web-noise-suppressor/speexWorklet.js?url";
import speexWasmPath from "@sapphi-red/web-noise-suppressor/speex.wasm?url";

function App() {
  const [isReady, setIsReady] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const speexNodeRef = useRef<any>(null); // Type as appropriate for SpeexWorkletNode
  const [isProcessing, setIsProcessing] = useState(false);

  // Separate initialization function that requires user interaction
  const initializeAudio = async () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      
      const ctx = audioContextRef.current;
      
      // Ensure context is running
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      console.log("1: Setup...");
      const speexWasmBinary = await loadSpeex({ url: speexWasmPath });
      await ctx.audioWorklet.addModule(speexWorkletPath);
      console.log("1: Setup done");

      console.log("2: Loading...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression: false,
          echoCancellation: false,
          autoGainControl: false,
        },
      });

      if (mediaStreamSourceRef.current) {
        mediaStreamSourceRef.current.disconnect();
      }
      
      mediaStreamSourceRef.current = ctx.createMediaStreamSource(stream);
      console.log("2: Loaded");

      console.log("3: Start");
      speexNodeRef.current = new SpeexWorkletNode(ctx, {
        wasmBinary: speexWasmBinary,
        maxChannels: 2,
    
      });

      mediaStreamSourceRef.current.connect(speexNodeRef.current);
      speexNodeRef.current.connect(ctx.destination);
      setIsProcessing(true);
      setIsReady(true);
    } catch (error) {
      console.error('Error initializing audio:', error);
      setIsReady(false);
    }
  };

  // Cleanup function
  const cleanup = () => {
    if (audioContextRef.current) {
      if (mediaStreamSourceRef.current) {
        mediaStreamSourceRef.current.disconnect();
      }
      if (speexNodeRef.current) {
        speexNodeRef.current.disconnect();
      }
      audioContextRef.current.close();
      audioContextRef.current = null;
      mediaStreamSourceRef.current = null;
      speexNodeRef.current = null;
      setIsProcessing(false);
      setIsReady(false);
    }
  };

  useEffect(() => {
    return cleanup;
  }, []);

  return (
    <div>
      <button 
        onClick={initializeAudio}
        disabled={isReady}
      >
        {isReady ? 'Audio Running' : 'Start Audio'}
      </button>
      {isProcessing && <div>Processing audio...</div>}
    </div>
  );
}

export default App;

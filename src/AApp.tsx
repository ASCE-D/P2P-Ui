import React, { useEffect, useRef, useState } from "react";
import {
  loadSpeex,
  SpeexWorkletNode,
  loadRnnoise,
  RnnoiseWorkletNode,
} from "@sapphi-red/web-noise-suppressor";
import speexWorkletPath from "@sapphi-red/web-noise-suppressor/speexWorklet.js?url";
import speexWasmPath from "@sapphi-red/web-noise-suppressor/speex.wasm?url";
import rnnoiseWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseWasmSimdPath from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import rnnoiseWorkletPath from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";

function App() {
  const [isReady, setIsReady] = useState(false);
  // const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const speexNodeRef = useRef<any>(null); // Type as appropriate for SpeexWorkletNode
  const [isProcessing, setIsProcessing] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rnnoiseNodeRef = useRef<RnnoiseWorkletNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // let rnnoise = useRef<RnnoiseWorkletNode | undefined>(null);

  // Separate initialization function that requires user interaction
  const initializeAudio = async () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      const ctx = audioContextRef.current;

      // Setup RNNoise
      console.log("1: Setup...");
      const rnnoiseWasmBinary = await loadRnnoise({
        url: rnnoiseWasmPath,
        simdUrl: rnnoiseWasmSimdPath,
      });
      await ctx.audioWorklet.addModule(rnnoiseWorkletPath);
      console.log("1: Setup done");

      // Get microphone access
      console.log("2: Loading...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression: false,
          echoCancellation: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      // Clean up previous nodes
      sourceNodeRef.current?.disconnect();
      rnnoiseNodeRef.current?.destroy();
      rnnoiseNodeRef.current?.disconnect();
      gainNodeRef.current?.disconnect();

      // Create new audio nodes
      sourceNodeRef.current = ctx.createMediaStreamSource(stream);
      rnnoiseNodeRef.current = new RnnoiseWorkletNode(ctx, {
        wasmBinary: rnnoiseWasmBinary,
        maxChannels: 2,
      });
      gainNodeRef.current = new GainNode(ctx, { gain: 1 });

      // Connect the audio graph
      sourceNodeRef.current.connect(rnnoiseNodeRef.current);
      rnnoiseNodeRef.current.connect(gainNodeRef.current);
      gainNodeRef.current.connect(ctx.destination);

      await ctx.resume();
      console.log("2: Processing started");

      setIsProcessing(true);
      setIsReady(true);
    } catch (err) {
      console.error("Failed to initialize audio:", err);

      cleanup();
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
      <button onClick={initializeAudio} disabled={isReady}>
        {isReady ? "Audio Running" : "Start Audio"}
      </button>
      {isProcessing && <div>Processing audio...</div>}
    </div>
  );
}

export default App;

import { useEffect, useRef, useState } from "react";
import {
  loadRnnoise,
  RnnoiseWorkletNode,
} from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorkletPath from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseWasmSimdPath from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";

interface UseAudioProcessingProps {
  peerConnection: RTCPeerConnection | null;
  stream: MediaStream | null;
  enabled?: boolean;
}

export const useAudioProcessing = ({
  peerConnection,
  stream,
  enabled = true,
}: UseAudioProcessingProps) => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rnnoiseNodeRef = useRef<RnnoiseWorkletNode | null>(null);
  const destinationStreamRef = useRef<MediaStream | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const setupAudioProcessing = async () => {
      if (!stream || !peerConnection || !enabled) return;

      try {
        // Initialize audio context
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext();
        }
        const ctx = audioContextRef.current;

        // Setup RNNoise
        console.log("Setting up RNNoise...");
        const rnnoiseWasmBinary = await loadRnnoise({
          url: rnnoiseWasmPath,
          simdUrl: rnnoiseWasmSimdPath,
        });
        await ctx.audioWorklet.addModule(rnnoiseWorkletPath);

        // Create audio nodes
        sourceNodeRef.current?.disconnect();
        rnnoiseNodeRef.current?.destroy();
        rnnoiseNodeRef.current?.disconnect();

        // Get the audio track from the stream
        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack) {
          throw new Error("No audio track found in stream");
        }

        // Create source node from the original stream
        sourceNodeRef.current = ctx.createMediaStreamSource(stream);

        // Create RNNoise node
        rnnoiseNodeRef.current = new RnnoiseWorkletNode(ctx, {
          wasmBinary: rnnoiseWasmBinary,
          maxChannels: 2,
        });

        // Create a destination stream
        const destination = ctx.createMediaStreamDestination();
        destinationStreamRef.current = destination.stream;

        // Connect the audio processing chain
        sourceNodeRef.current.connect(rnnoiseNodeRef.current);
        rnnoiseNodeRef.current.connect(destination);

        // Resume audio context
        await ctx.resume();

        // Remove existing tracks from peer connection
        peerConnection.getSenders().forEach((sender) => {
          peerConnection.removeTrack(sender);
        });

        // Add the processed audio track to peer connection
        const processedTrack = destination.stream.getAudioTracks()[0];
        if (processedTrack) {
          console.log("Adding processed audio track to peer connection");
          peerConnection.addTrack(processedTrack, destination.stream);

          // Add any video tracks from the original stream
          stream.getVideoTracks().forEach((videoTrack) => {
            console.log("Adding video track to peer connection");
            peerConnection.addTrack(videoTrack, stream);
          });
        }

        if (isMounted) {
          setIsProcessing(true);
          setError(null);
        }
      } catch (err) {
        console.error("Audio processing setup failed:", err);
        if (isMounted) {
          setError(
            err instanceof Error ? err.message : "Audio processing setup failed"
          );
          setIsProcessing(false);
        }
        cleanup();
      }
    };

    const cleanup = () => {
      if (rnnoiseNodeRef.current) {
        rnnoiseNodeRef.current.destroy();
        rnnoiseNodeRef.current.disconnect();
        rnnoiseNodeRef.current = null;
      }

      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect();
        sourceNodeRef.current = null;
      }

      if (destinationStreamRef.current) {
        destinationStreamRef.current
          .getTracks()
          .forEach((track) => track.stop());
        destinationStreamRef.current = null;
      }

      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }

      if (isMounted) {
        setIsProcessing(false);
      }
    };

    setupAudioProcessing();

    return () => {
      isMounted = false;
      cleanup();
    };
  }, [peerConnection, stream, enabled]);

  return {
    isProcessing,
    error,
  };
};

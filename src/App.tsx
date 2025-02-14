import React, { useEffect, useRef, useState } from "react";
import { Socket, io } from "socket.io-client";
import { DeviceSelectionState, CallState, User } from "./types";
import { SpeexWorkletNode } from "@sapphi-red/web-noise-suppressor";
import speexWorkletPath from "@sapphi-red/web-noise-suppressor/speexWorklet.js?url";
import speexWasmPath from "@sapphi-red/web-noise-suppressor/speex.wasm?url";

const VideoCall: React.FC = () => {
  const [devices, setDevices] = useState<DeviceSelectionState>({
    audioInput: [],
    audioOutput: [],
    videoInput: [],
    selectedAudioInput: "",
    selectedAudioOutput: "",
    selectedVideoInput: "",
  });

  const [callState, setCallState] = useState<CallState>({
    isInCall: false,
    remoteStream: null,
    localStream: null,
    remoteSocketId: null,
  });

  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [socketId, setSocketId] = useState<string>("");
  const [userId, setUserId] = useState<string>(
    `User_${Math.floor(Math.random() * 1000)}`
  );
  const [isCalling, setIsCalling] = useState(false);
  const [isTestAudioMuted, setIsTestAudioMuted] = useState(true);

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const socket = useRef<Socket | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const rnnoiseNode = useRef<AudioWorkletNode | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  // const workletLoaded = useRef(false); // Track worklet loading

  const speex = useRef<SpeexWorkletNode | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const workletLoaded = useRef(false);
  const speexWasmBinaryRef = useRef<ArrayBuffer | null>(null);

  useEffect(() => {
    const loadSpeexWorklet = async () => {
      console.log("Starting Speex worklet initialization...");

      try {
        // Create AudioContext
        console.log("Creating new AudioContext...");
        ctx.current = new AudioContext();
        console.log("AudioContext created successfully:", ctx.current.state);

        // Fetch WASM binary
        console.log(`Fetching Speex WASM from path: ${speexWasmPath}`);
        const response = await fetch(speexWasmPath);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch WASM: ${response.status} ${response.statusText}`
          );
        }

        const speexWasmBinary = await response.arrayBuffer();
        console.log(
          "WASM binary loaded successfully, size:",
          speexWasmBinary.byteLength
        );
        speexWasmBinaryRef.current = speexWasmBinary;

        // Load AudioWorklet module
        console.log(
          `Adding AudioWorklet module from path: ${speexWorkletPath}`
        );
        await ctx.current.audioWorklet.addModule(speexWorkletPath);
        console.log("AudioWorklet module loaded successfully");

        workletLoaded.current = true;
        console.log("Speex initialization completed successfully");
      } catch (error: any) {
        console.error("Speex initialization failed:", {
          error: error.message,
          stack: error.stack,
          context: {
            audioContextState: ctx.current?.state,
            workletLoaded: workletLoaded.current,
            wasmBinaryLoaded: !!speexWasmBinaryRef.current,
          },
        });

        // You might want to set an error state here
        // setInitError(error.message);
      }
    };

    loadSpeexWorklet();

    return () => {
      console.log("Cleaning up Speex resources...");

      if (speex.current) {
        console.log("Disconnecting Speex node");
        try {
          speex.current.disconnect();
        } catch (error) {
          console.warn("Error disconnecting Speex node:", error);
        }
      }

      if (ctx.current) {
        console.log("Closing AudioContext");
        try {
          ctx.current.close();
        } catch (error) {
          console.warn("Error closing AudioContext:", error);
        }
      }

      console.log("Cleanup completed");
    };
  }, []);

  useEffect(() => {
    console.log("🔄 Initializing VideoCall component");

    socket.current = io("https://signaling-nodejs.onrender.com");

    peerConnection.current = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    setupPeerConnectionHandlers();
    setupSocketHandlers();
    loadDevices();

    return () => {
      console.log("🧹 Cleaning up VideoCall component");
      if (callState.localStream) {
        callState.localStream.getTracks().forEach((track) => track.stop());
      }
      socket.current?.disconnect();
      peerConnection.current?.close();
    };
  }, []);

  useEffect(() => {
    if (socket.current && userId) {
      console.log("📝 Registering user:", userId);
      socket.current.emit("register", { userId, socketId: socket.current.id });
    }
  }, [userId, socketId]);

  // useEffect(() => {
  //   const loadRnnoise = async () => {
  //     try {
  //       audioContext.current = new AudioContext();
  //       await audioContext.current.audioWorklet.addModule(
  //         NoiseSuppressorWorklet
  //       );
  //       rnnoiseNode.current = new AudioWorkletNode(
  //         audioContext.current,
  //         NoiseSuppressorWorklet_Name
  //       );
  //       workletLoaded.current = true;
  //     } catch (error) {
  //       console.error("Error loading RNNoise:", error);
  //     }
  //   };

  //   loadRnnoise(); // Load RNNoise only once

  //   return () => {
  //     if (audioContext.current) {
  //       audioContext.current.close();
  //     }
  //   };
  // }, []);

  const setupPeerConnectionHandlers = () => {
    if (!peerConnection.current) return;

    peerConnection.current.ontrack = (event) => {
      console.log("📥 Received remote track:", event.track.kind);
      if (event.streams && event.streams[0]) {
        // Check if streams exist
        if (event.track.kind === "video" && remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        } else if (event.track.kind === "audio" && remoteVideoRef.current) {
          // If you have a separate audio element, set it here. Otherwise, the video element will play both.
          // remoteAudioRef.current.srcObject = event.streams[0];
        }
        setCallState((prev) => ({
          ...prev,
          remoteStream: event.streams[0],
        }));
      }
    };

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate && callState.remoteSocketId) {
        console.log("🧊 New ICE candidate:", event.candidate);
        socket.current?.emit("ice-candidate", {
          to: callState.remoteSocketId,
          candidate: event.candidate,
        });
      }
    };

    peerConnection.current.oniceconnectionstatechange = () => {
      console.log(
        "🌐 ICE Connection State:",
        peerConnection.current?.iceConnectionState
      );
    };

    peerConnection.current.onconnectionstatechange = () => {
      console.log(
        "🔌 Connection State:",
        peerConnection.current?.connectionState
      );
      if (peerConnection.current?.connectionState === "disconnected") {
        resetCallState();
      }
    };
  };

  const setupSocketHandlers = () => {
    if (!socket.current) return;

    socket.current.on("connect", () => {
      console.log("🔌 Connected to signaling server");
      // @ts-ignore
      setSocketId(socket.current!.id);
    });

    socket.current.on("active-users", (users: User[]) => {
      console.log("👥 Active users updated:", users);
      setAvailableUsers(users.filter((user) => user.socketId !== socketId));
    });

    socket.current.on("call-received", async ({ from, offer }) => {
      console.log("📞 Received call from socket:", from);

      const caller = availableUsers.find((user) => user.socketId === from);
      const confirmed = window.confirm(
        `Incoming call from ${caller?.userId || "Unknown User"}. Accept?`
      );

      if (!confirmed) {
        socket.current?.emit("call-rejected", { to: from });
        return;
      }

      setCallState((prev) => ({ ...prev, remoteSocketId: from }));

      try {
        await startLocalStream();
        await peerConnection.current?.setRemoteDescription(
          new RTCSessionDescription(offer)
        );

        const answer = await peerConnection.current?.createAnswer();
        await peerConnection.current?.setLocalDescription(answer);

        socket.current?.emit("call-accepted", {
          to: from,
          answer,
        });
      } catch (error) {
        console.error("❌ Error handling incoming call:", error);
        socket.current?.emit("call-failed", {
          to: from,
          error: "Failed to establish connection",
        });
      }
    });

    socket.current.on("call-accepted", async ({ from, answer }) => {
      try {
        setCallState((prev) => ({ ...prev, isInCall: true }));
        await peerConnection.current?.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
      } catch (error) {
        console.error("❌ Error setting remote description:", error);
      }
    });

    socket.current.on("call-rejected", ({ from }) => {
      alert(
        `Call rejected by ${
          availableUsers.find((user) => user.socketId === from)?.userId ||
          "user"
        }`
      );
      resetCallState();
    });

    socket.current.on("ice-candidate", async ({ from, candidate }) => {
      try {
        if (peerConnection.current?.remoteDescription) {
          await peerConnection.current?.addIceCandidate(
            new RTCIceCandidate(candidate)
          );
        }
      } catch (error) {
        console.error("❌ Error adding ICE candidate:", error);
      }
    });

    socket.current.on("user-disconnected", ({ socketId }) => {
      if (socketId === callState.remoteSocketId) {
        alert("Remote user disconnected");
        resetCallState();
      }
    });

    socket.current.on("call-failed", ({ error }) => {
      console.error("❌ Call failed:", error);
      alert(`Call failed: ${error}`);
      resetCallState();
    });
  };

  const resetCallState = () => {
    if (callState.localStream) {
      callState.localStream.getTracks().forEach((track) => track.stop());
    }

    setCallState({
      isInCall: false,
      remoteStream: null,
      localStream: null,
      remoteSocketId: null,
    });
  };

  const loadDevices = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      const devices = await navigator.mediaDevices.enumerateDevices();

      setDevices((prev) => ({
        ...prev,
        audioInput: devices.filter((d) => d.kind === "audioinput"),
        audioOutput: devices.filter((d) => d.kind === "audiooutput"),
        videoInput: devices.filter((d) => d.kind === "videoinput"),
        selectedAudioInput:
          devices.find((d) => d.kind === "audioinput")?.deviceId || "",
        selectedAudioOutput:
          devices.find((d) => d.kind === "audiooutput")?.deviceId || "",
        selectedVideoInput:
          devices.find((d) => d.kind === "videoinput")?.deviceId || "",
      }));
    } catch (error) {
      console.error("Error loading devices:", error);
      alert(
        "Failed to access media devices. Please ensure you have a camera and microphone connected."
      );
    }
  };

  interface AddOrReplaceTrackParams {
    track: MediaStreamTrack;
    stream: MediaStream;
  }

  const addOrReplaceTrack = ({ track, stream }: AddOrReplaceTrackParams) => {
    if (!peerConnection.current) return;

    const senders = peerConnection.current.getSenders();
    const sender = senders.find((s) => s.track && s.track.kind === track.kind);

    if (sender) {
      sender
        .replaceTrack(track)
        .then(() => {
          if (peerConnection.current?.signalingState !== "stable") {
            handleNegotiationNeeded();
          }
          console.log(`Replaced ${track.kind} track`);
        })
        .catch((error) => {
          console.error(`Error replacing ${track.kind} track:`, error);
          // Handle error appropriately (e.g., alert the user)
        });
    } else {
      try {
        peerConnection.current.addTrack(track, stream);
      } catch (error) {
        console.error(`Error adding ${track.kind} track:`, error);
        // Handle error appropriately
      }
    }
  };

  const startLocalStream = async () => {
    try {
      if (callState.localStream) {
        callState.localStream.getTracks().forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: devices.selectedAudioInput,
          echoCancellation: true,
          noiseSuppression: false, // RNNoise handles noise suppression
          autoGainControl: true,
        },
        video: {
          deviceId: devices.selectedVideoInput,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      if (!stream) {
        console.error("getUserMedia returned undefined.");
        alert("Unable to access camera or microphone.");
        return;
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      setCallState((prev) => ({ ...prev, localStream: stream }));

      console.log("Audio Tracks:", stream.getAudioTracks());
      console.log("Video Tracks:", stream.getVideoTracks());

      console.log("Initialization check:", {
        speexCurrent: !!speex.current,
        ctxCurrent: !!ctx.current,
        wasmBinary: !!speexWasmBinaryRef.current,
        workletLoaded: workletLoaded.current,
      });

      if (ctx.current && speexWasmBinaryRef.current && workletLoaded.current) {
        console.log("Starting Speex processing...");

        if (ctx.current.state === "suspended") {
          console.log("Resuming AudioContext...");
          await ctx.current.resume();
          console.log("AudioContext state after resume:", ctx.current.state);
        }

        const audioTracks = stream.getAudioTracks();

        if (audioTracks.length > 0) {
          const audioTrack = audioTracks[0];
          const source = ctx.current.createMediaStreamSource(stream);
          console.log(
            "MediaStreamSource created:",
            source.channelCount,
            "channels"
          );

          try {
            speex.current = new SpeexWorkletNode(ctx.current, {
              wasmBinary: speexWasmBinaryRef.current,
              maxChannels: 2,
            });
            console.log("Speex Node created successfully:", speex.current);

            const audioDestination = ctx.current.createMediaStreamDestination();
            console.log("AudioDestination created");

            source.connect(speex.current);
            console.log("Source connected to Speex");

            speex.current.connect(audioDestination);
            console.log("Speex connected to destination");

            const processedAudioTrack =
              audioDestination.stream.getAudioTracks()[0];
            console.log(
              "Processed audio track obtained:",
              processedAudioTrack.enabled,
              processedAudioTrack.readyState
            );

            // Create a test audio element
            const testAudio = document.createElement("audio");
            testAudio.id = "processed-audio-test";
            testAudio.autoplay = true;
            testAudio.muted = isTestAudioMuted; // Use the React state
            document.body.appendChild(testAudio);

            // Create a stream with only processed audio for testing
            const testStream = new MediaStream([processedAudioTrack]);
            testAudio.srcObject = testStream;

            console.log("Test audio element created and stream attached");

            // Create processed stream for peer connection
            const processedStream = new MediaStream([
              processedAudioTrack,
              ...stream.getVideoTracks(),
            ]);

            console.log("Processed Stream tracks:", {
              audio: processedStream.getAudioTracks().length,
              video: processedStream.getVideoTracks().length,
            });

            // Add a volume meter for visual feedback
            const audioContext = new AudioContext();
            const analyser = audioContext.createAnalyser();
            const source2 = audioContext.createMediaStreamSource(testStream);
            source2.connect(analyser);

            analyser.fftSize = 256;
            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            function checkAudioLevel() {
              analyser.getByteFrequencyData(dataArray);
              const average =
                dataArray.reduce((a, b) => a + b) / dataArray.length;
              console.log("Audio level:", average);

              requestAnimationFrame(checkAudioLevel);
            }

            checkAudioLevel();

            // Rest of your code for peer connection...
            processedStream.getTracks().forEach((track) => {
              console.log(`Adding/replacing ${track.kind} track:`, {
                enabled: track.enabled,
                readyState: track.readyState,
                muted: track.muted,
              });
              addOrReplaceTrack({ track, stream: processedStream });
            });

            if (processedAudioTrack.readyState === "live") {
              audioTrack.stop();
              console.log("Original audio track stopped");
            }

            // Cleanup function
            return () => {
              testAudio.remove();
              audioContext.close();
            };
          } catch (speexError) {
            console.error("Error in Speex processing chain:", speexError);
            stream
              .getTracks()
              .forEach((track) => addOrReplaceTrack({ track, stream }));
          }
        }
      } else {
        console.log("Using original stream (Speex not initialized)");
        stream
          .getTracks()
          .forEach((track) => addOrReplaceTrack({ track, stream }));
      }
    } catch (error) {
      console.error("Error starting local stream:", error);
      throw error;
    }
  };

  const handleNegotiationNeeded = async () => {
    try {
      const offer = await peerConnection.current?.createOffer();
      await peerConnection.current?.setLocalDescription(offer);
      socket.current?.emit("call", {
        to: callState.remoteSocketId,
        offer,
      });
    } catch (error) {
      console.error("Error creating offer:", error);
    }
  };

  useEffect(() => {
    if (peerConnection.current) {
      peerConnection.current.onnegotiationneeded = handleNegotiationNeeded;
    }
  }, [peerConnection.current]);

  const handleDeviceChange = async (
    deviceId: string,
    kind: "audioinput" | "audiooutput" | "videoinput"
  ) => {
    setDevices((prev) => ({
      ...prev,
      [`selected${kind.charAt(0).toUpperCase() + kind.slice(1)}`]: deviceId,
    }));

    if (
      kind === "audiooutput" &&
      remoteVideoRef.current &&
      "setSinkId" in remoteVideoRef.current
    ) {
      try {
        // @ts-ignore - setSinkId is not in HTMLVideoElement type yet
        await remoteVideoRef.current.setSinkId(deviceId);
      } catch (error) {
        console.error("Error setting audio output device:", error);
      }
    }

    if (
      (kind === "audioinput" || kind === "videoinput") &&
      callState.localStream
    ) {
      await startLocalStream();
    }
  };

  const makeCall = async (targetSocketId: string) => {
    if (isCalling) return;
    setIsCalling(true);
    console.log("📞 Initiating call to socket:", targetSocketId);

    try {
      await startLocalStream();
      setCallState((prev) => ({ ...prev, remoteSocketId: targetSocketId }));

      const offer = await peerConnection.current?.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      await peerConnection.current?.setLocalDescription(offer);

      socket.current?.emit("call-user", {
        to: targetSocketId,
        offer,
      });
    } catch (error) {
      console.error("❌ Error making call:", error);
      resetCallState();
    } finally {
      setIsCalling(false);
    }
  };

  const endCall = () => {
    socket.current?.emit("end-call", { to: callState.remoteSocketId });
    resetCallState();
  };

  return (
    <div className="p-4">
      <div className="mb-4">
        <h2 className="text-xl font-bold mb-2">Your Info</h2>
        <p>Your ID: {userId}</p>
        <p>Socket ID: {socketId}</p>

        <h3 className="text-lg font-bold mt-4">Available Users</h3>
        <div className="space-y-2">
          {availableUsers.map((user) => (
            <button
              key={user.socketId}
              onClick={() => makeCall(user.socketId)}
              className="block w-full p-2 text-left border rounded hover:bg-gray-100"
            >
              Call {user.userId.userId} (Socket: {user.socketId})
            </button>
          ))}
        </div>

        <h2 className="text-xl font-bold mb-2">Device Selection</h2>
        <div className="space-y-2">
          <select
            value={devices.selectedAudioInput}
            onChange={(e) => handleDeviceChange(e.target.value, "audioinput")}
            className="block w-full p-2 border rounded"
          >
            {devices.audioInput.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${device.deviceId}`}
              </option>
            ))}
          </select>

          <select
            value={devices.selectedAudioOutput}
            onChange={(e) => handleDeviceChange(e.target.value, "audiooutput")}
            className="block w-full p-2 border rounded"
          >
            {devices.audioOutput.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Speaker ${device.deviceId}`}
              </option>
            ))}
          </select>

          <select
            value={devices.selectedVideoInput}
            onChange={(e) => handleDeviceChange(e.target.value, "videoinput")}
            className="block w-full p-2 border rounded"
          >
            {devices.videoInput.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${device.deviceId}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="text-lg font-bold mb-2">Local Video</h3>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full bg-black"
          />
        </div>
        <div>
          <h3 className="text-lg font-bold mb-2">Remote Video</h3>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full bg-black"
          />
        </div>
      </div>

      <div className="mt-4 space-x-2">
        <button
          onClick={() => startLocalStream()}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          Start Camera
        </button>
        <button
          onClick={() => {
            const testAudio = document.getElementById("processed-audio-test");
            if (testAudio) {
              const newMutedState = !(testAudio as HTMLMediaElement).muted;
              (testAudio as HTMLMediaElement).muted = newMutedState;
              setIsTestAudioMuted(newMutedState);
              console.log("Test audio muted:", newMutedState);
            }
          }}
          className="px-4 py-2 bg-green-500 text-white rounded"
        >
          {isTestAudioMuted ? "Unmute Test Audio" : "Mute Test Audio"}
        </button>
        <button
          className="px-4 py-2 bg-red-600 text-white rounded"
          onClick={endCall}
        >
          End call
        </button>
      </div>
    </div>
  );
};

export default VideoCall;

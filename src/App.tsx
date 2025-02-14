import React, { useEffect, useRef, useState } from "react";
import { Socket, io } from "socket.io-client";
import { DeviceSelectionState, CallState, User } from "./types";
import { NoiseSuppressorWorklet_Name } from "@timephy/rnnoise-wasm";
import NoiseSuppressorWorklet from "@timephy/rnnoise-wasm/NoiseSuppressorWorklet?worker&url";

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

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const socket = useRef<Socket | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const rnnoiseNode = useRef<AudioWorkletNode | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const workletLoaded = useRef(false); // Track worklet loading

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
          echoCancellation: true, // Keep echo cancellation
          noiseSuppression: false, // Turn off browser noise suppression, RNNoise handles it
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

      console.log("Audio Tracks:", stream.getAudioTracks()); // Check tracks immediately
      console.log("Video Tracks:", stream.getVideoTracks()); // Check tracks immediately

      // *** Simplified Track Addition (NO RNNoise, NO replaceTrack) ***
      // if (peerConnection.current) {
      //   stream.getTracks().forEach((track) => {
      //     console.log("Adding Track:", track); // Log before adding
      //     peerConnection.current?.addTrack(track, stream);
      //   });
      // }

      // *** RNNoise Integration ***
      if (
        rnnoiseNode.current &&
        audioContext.current &&
        workletLoaded.current
      ) {
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
          const audioTrack = audioTracks[0]; // Get the first audio track

          // 1. Create Source Node
          const source = audioContext.current.createMediaStreamSource(stream);

          // 2. Connect Source to RNNoise Node
          source.connect(rnnoiseNode.current);

          // 3. Create Destination (for processed audio)
          const destination =
            audioContext.current.createMediaStreamDestination();

          // 4. Connect RNNoise to Destination
          rnnoiseNode.current.connect(destination);

          // 5. Create new processed stream
          const processedStream = new MediaStream([
            destination.stream.getAudioTracks()[0],
            ...stream.getVideoTracks(),
          ]);

          console.log(
            "Processed Audio Tracks:",
            processedStream.getAudioTracks()
          );
          // 6. Add/Replace Tracks in Peer Connection
          processedStream
            .getTracks()
            .forEach((track) =>
              addOrReplaceTrack({ track, stream: processedStream })
            );

          // 7. Stop original audio track
          audioTrack.stop();
        } else {
          console.warn("No audio track found for RNNoise processing.");
          stream
            .getTracks()
            .forEach((track) => addOrReplaceTrack({ track, stream })); // Add original tracks
        }
      } else {
        console.log("RNNoise not loaded. Using original stream.");
        stream
          .getTracks()
          .forEach((track) => addOrReplaceTrack({ track, stream })); // Add original tracks
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
      </div>
    </div>
  );
};

export default VideoCall;

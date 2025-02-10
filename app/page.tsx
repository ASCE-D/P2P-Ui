"use client";

import { useEffect, useRef } from "react";
import { io } from "socket.io-client";

const VideoCall = () => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const socket = io("http://localhost:8080", {
    transports: ["websocket"],
    autoConnect: true,
  });

  useEffect(() => {
    let pc: RTCPeerConnection;

    const initWebRTC = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      // Add local tracks
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Handle remote tracks
      pc.ontrack = (event) => {
        if (remoteVideoRef.current && !remoteVideoRef.current.srcObject) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      // ICE Candidate handling
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("iceCandidate", event.candidate.toJSON());
        }
      };

      // Socket.IO event listeners
      socket.on("answer", async (answerSDP: string) => {
        await pc.setRemoteDescription({
          type: "answer",
          sdp: answerSDP,
        });
      });

      socket.on("iceCandidate", (candidate: RTCIceCandidateInit) => {
        pc.addIceCandidate(new RTCIceCandidate(candidate));
      });

      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("offer", offer.sdp);
    };

    initWebRTC();

    return () => {
      if (pc) pc.close();
      socket.disconnect();
    };
  }, []);

  return (
    <div>
      <video ref={localVideoRef} autoPlay muted className="w-48 h-36" />
      <video ref={remoteVideoRef} autoPlay className="w-full h-screen" />
    </div>
  );
};

export default VideoCall;

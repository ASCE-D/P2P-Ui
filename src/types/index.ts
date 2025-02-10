// src/types.ts

export interface DeviceSelectionState {
  audioInput: MediaDeviceInfo[];
  audioOutput: MediaDeviceInfo[];
  videoInput: MediaDeviceInfo[];
  selectedAudioInput: string;
  selectedAudioOutput: string;
  selectedVideoInput: string;
}

export interface CallState {
  isInCall: boolean;
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  remoteSocketId: string | null;
}

export interface User {
  socketId: string;
  userId: {
    userId: string;
  };
}

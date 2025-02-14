import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const AudioDebugger = ({ stream, rnnoiseNode, audioContext }: any) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);

  const testAudioChain = async () => {
    if (!stream) {
      console.error("No stream available");
      return;
    }

    try {
      // Create a new audio element
      const audio: any = audioRef.current;

      if (isPlaying) {
        audio.pause();
        audio.srcObject = null;
        setIsPlaying(false);
        return;
      }

      // Test different points in the audio chain
      let testStream;

      if (rnnoiseNode && audioContext) {
        // Test processed audio
        const source = audioContext.createMediaStreamSource(stream);
        const destination = audioContext.createMediaStreamDestination();

        // Connect the chain
        source.connect(rnnoiseNode);
        rnnoiseNode.connect(destination);

        testStream = destination.stream;
        console.log(
          "Testing processed audio stream:",
          testStream.getAudioTracks()
        );
      } else {
        // Test original stream
        testStream = stream;
        console.log(
          "Testing original audio stream:",
          testStream.getAudioTracks()
        );
      }

      // Play the stream
      audio.srcObject = testStream;
      await audio.play();
      setIsPlaying(true);
    } catch (error) {
      console.error("Audio test failed:", error);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Audio Debug Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2">
          <audio ref={audioRef} controls className="w-full" />
          <Button
            onClick={testAudioChain}
            className={isPlaying ? "bg-red-500 hover:bg-red-600" : ""}
          >
            {isPlaying ? "Stop Test Audio" : "Test Audio Chain"}
          </Button>
          <div className="text-sm">
            <p>Audio Tracks: {stream?.getAudioTracks().length || 0}</p>
            <p>RNNoise Active: {rnnoiseNode ? "Yes" : "No"}</p>
            <p>Audio Context State: {audioContext?.state}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default AudioDebugger;

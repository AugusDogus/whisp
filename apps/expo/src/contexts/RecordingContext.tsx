import React, { createContext, useContext, useState } from "react";

interface RecordingContextType {
  isRecording: boolean;
  setIsRecording: (recording: boolean) => void;
  isSendMode: boolean;
  setIsSendMode: (sendMode: boolean) => void;
}

const RecordingContext = createContext<RecordingContextType | undefined>(
  undefined,
);

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isSendMode, setIsSendMode] = useState(false);

  return (
    <RecordingContext.Provider
      value={{ isRecording, setIsRecording, isSendMode, setIsSendMode }}
    >
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecording() {
  const context = useContext(RecordingContext);
  if (context === undefined) {
    throw new Error("useRecording must be used within a RecordingProvider");
  }
  return context;
}

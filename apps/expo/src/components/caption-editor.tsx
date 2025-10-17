import type { SharedValue } from "react-native-reanimated";
import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Platform, StyleSheet, TextInput, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import {
  Canvas,
  Group,
  matchFont,
  Paragraph,
  RoundedRect,
  Skia,
  TextAlign,
} from "@shopify/react-native-skia";

export interface CaptionData {
  id: string;
  text: string;
  x: number; // normalized 0-1
  y: number; // normalized 0-1
  fontSize: number;
  color: string;
}

// Individual caption component to properly use useAnimatedStyle
interface AnimatedCaptionProps {
  caption: CaptionData;
  containerWidth: number;
  containerHeight: number;
  draggingCaptionIdShared: SharedValue<string | null>;
  translateY: SharedValue<number>;
  actualYPositions: SharedValue<Record<string, number>>;
  showCursor: boolean;
  overrideText?: string; // Use this text for cursor calculation when editing
  font: ReturnType<typeof matchFont> | null;
}

function AnimatedCaption({
  caption,
  containerWidth,
  containerHeight,
  draggingCaptionIdShared,
  translateY,
  actualYPositions,
  showCursor,
  overrideText,
  font,
}: AnimatedCaptionProps) {
  // Use overrideText for display if provided (for real-time editing)
  const displayText = overrideText ?? caption.text;

  // Create paragraph for proper kerning and text shaping
  const paragraph = useMemo(() => {
    if (!font) return null;
    // Add a non-breaking space after the text so Paragraph accounts for trailing spaces
    // Regular spaces get trimmed, but nbsp forces the paragraph to include them
    // Always include nbsp even if text is empty so cursor can be positioned
    const textForMeasurement = `${displayText}\u00A0`;

    const paragraphStyle = {
      textAlign: TextAlign.Center,
    };

    const textStyle = {
      color: Skia.Color(TEXT_COLOR),
      fontSize: FONT_SIZE,
      fontFamilies: [
        Platform.select({
          ios: "Helvetica Neue",
          android: "sans-serif",
          default: "sans-serif",
        }),
      ],
      fontStyle: {
        weight: 700, // Bold
      },
    };

    const builder = Skia.ParagraphBuilder.Make(paragraphStyle);
    builder.pushStyle(textStyle);
    builder.addText(textForMeasurement);
    builder.pop();
    const p = builder.build();
    p.layout(containerWidth - PILL_PADDING_H * 2); // Layout with max width
    return p;
  }, [displayText, containerWidth, font]);

  const animatedStyle = useAnimatedStyle(() => {
    const isDragging = draggingCaptionIdShared.value === caption.id;

    // Use the actual Y position from shared value if available, otherwise use prop
    const actualY = actualYPositions.value[caption.id];
    const baseTop =
      actualY !== undefined
        ? actualY * containerHeight
        : caption.y * containerHeight;

    return {
      top: baseTop,
      transform: isDragging ? [{ translateY: translateY.value }] : [],
    };
  });

  return (
    <Animated.View
      style={[
        styles.captionContainer,
        {
          left: 0,
          right: 0,
          width: containerWidth,
        },
        animatedStyle,
      ]}
      pointerEvents="none"
    >
      <Canvas
        style={{
          width: containerWidth,
          height: FONT_SIZE * 1.2 + PILL_PADDING_V * 2,
        }}
      >
        <Group>
          <RoundedRect
            x={0}
            y={0}
            width={containerWidth}
            height={FONT_SIZE * 1.2 + PILL_PADDING_V * 2}
            r={0}
            color={PILL_BG_COLOR}
          />
          {paragraph && (
            <>
              {(() => {
                // Paragraph width includes trailing spaces thanks to the nbsp we added
                const textWidth = paragraph.getLongestLine();

                // Text is centered based on paragraph width
                const availableWidth = containerWidth - PILL_PADDING_H * 2;
                const textStartX =
                  PILL_PADDING_H + (availableWidth - textWidth) / 2;

                // Cursor position: at the end of text
                const cursorX = textStartX + textWidth - 3;

                return (
                  <>
                    <Paragraph
                      paragraph={paragraph}
                      x={PILL_PADDING_H}
                      y={PILL_PADDING_V}
                      width={availableWidth}
                    />
                    {/* Show cursor at the end of text when editing */}
                    {showCursor && (
                      <RoundedRect
                        x={cursorX}
                        y={PILL_PADDING_V}
                        width={2}
                        height={FONT_SIZE * 1.2}
                        r={1}
                        color={TEXT_COLOR}
                      />
                    )}
                  </>
                );
              })()}
            </>
          )}
        </Group>
      </Canvas>
    </Animated.View>
  );
}

interface CaptionEditorProps {
  captions: CaptionData[];
  editingCaptionId: string | null;
  onUpdate: (caption: CaptionData) => void;
  onDelete: (id: string) => void;
  onStartEditing: (id: string) => void;
  onStopEditing: () => void;
  onTapCreate: (x: number, y: number) => void;
  containerWidth: number;
  containerHeight: number;
}

const FONT_SIZE = 16;
const PILL_PADDING_H = 12;
const PILL_PADDING_V = 6;
const PILL_BG_COLOR = "rgba(0, 0, 0, 0.6)";
const TEXT_COLOR = "#FFFFFF";
const MARGIN = 20; // Keep caption away from edges

export function CaptionEditor({
  captions,
  editingCaptionId,
  onUpdate,
  onDelete,
  onStartEditing,
  onStopEditing,
  onTapCreate,
  containerWidth,
  containerHeight,
}: CaptionEditorProps) {
  const editingCaption = captions.find((c) => c.id === editingCaptionId);
  const [inputValue, setInputValue] = useState(editingCaption?.text ?? "");
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const inputRef = useRef<TextInput>(null);

  // Blinking cursor state
  const [showCursor, setShowCursor] = useState(true);

  // Sync inputValue with editingCaption when editingCaptionId changes
  useEffect(() => {
    setInputValue(editingCaption?.text ?? "");
  }, [editingCaptionId, editingCaption?.text]);

  // Blink cursor when editing
  useEffect(() => {
    if (!editingCaptionId) {
      setShowCursor(false);
      return;
    }

    setShowCursor(true);
    const interval = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 500); // Blink every 500ms

    return () => clearInterval(interval);
  }, [editingCaptionId]);

  // Use system font for Skia rendering - matches across platforms
  const font = useMemo(() => {
    const fontFamily = Platform.select({
      ios: "Helvetica Neue",
      android: "sans-serif",
      default: "sans-serif",
    });
    return matchFont({
      fontFamily,
      fontSize: FONT_SIZE,
      fontWeight: "bold",
    });
  }, []);

  // Update input value when editing caption changes
  useEffect(() => {
    if (editingCaption) {
      setInputValue(editingCaption.text);
    }
  }, [editingCaption]);

  // Reset translation when not editing
  useEffect(() => {
    if (!editingCaptionId) {
      translateX.value = 0;
      translateY.value = 0;
    }
  }, [editingCaptionId, translateX, translateY]);

  // Note: textMetrics removed since we're using full-width bars now

  // Calculate position for editing caption
  const editingCaptionPosition = useMemo(() => {
    if (!editingCaption) return null;

    const x = editingCaption.x * containerWidth;
    const y = editingCaption.y * containerHeight;

    return { x, y };
  }, [editingCaption, containerWidth, containerHeight]);

  // Pan gesture for dragging captions - use shared value for reactive animation
  const draggingCaptionIdShared = useSharedValue<string | null>(null);
  // Store actual Y positions that update synchronously during drag
  const actualYPositions = useSharedValue<Record<string, number>>({});

  // Initialize actualYPositions from captions
  useEffect(() => {
    const positions: Record<string, number> = {};
    captions.forEach((caption) => {
      positions[caption.id] = caption.y;
    });
    actualYPositions.value = positions;
  }, [captions, actualYPositions]);

  const panGesture = Gesture.Pan()
    .enabled(!editingCaptionId) // Only allow dragging when not editing
    .onStart((event) => {
      "worklet";
      // Find which caption we're dragging
      const tapY = event.y;
      const barHeight = FONT_SIZE * 1.2 + PILL_PADDING_V * 2;

      for (const caption of captions) {
        const barTop = caption.y * containerHeight;
        const barBottom = barTop + barHeight;

        if (tapY >= barTop && tapY <= barBottom) {
          draggingCaptionIdShared.value = caption.id;
          return;
        }
      }
    })
    .onUpdate((event) => {
      "worklet";
      if (draggingCaptionIdShared.value) {
        translateY.value = event.translationY;
      }
    })
    .onEnd(() => {
      "worklet";
      const draggedCaptionId = draggingCaptionIdShared.value;
      if (!draggedCaptionId) return;

      const draggedCaption = captions.find((c) => c.id === draggedCaptionId);
      if (!draggedCaption) return;

      // Calculate new position
      const currentY = draggedCaption.y * containerHeight;
      const translateAmount = translateY.value;
      let newY = currentY + translateAmount;

      // Keep within bounds
      const barHeight = FONT_SIZE * 1.2 + PILL_PADDING_V * 2;
      const minY = MARGIN;
      const maxY = containerHeight - barHeight - MARGIN;

      newY = Math.max(minY, Math.min(maxY, newY));

      // Convert to normalized coordinates
      const normalizedY = newY / containerHeight;

      // Update the shared value immediately (synchronous on UI thread)
      actualYPositions.value = {
        ...actualYPositions.value,
        [draggedCaptionId]: normalizedY,
      };

      // Reset transform and dragging state
      translateY.value = 0;
      draggingCaptionIdShared.value = null;

      // Update React state (asynchronous)
      runOnJS(onUpdate)({
        ...draggedCaption,
        y: normalizedY,
      });
    });

  // Tap gesture for creating new caption or editing existing
  const tapGesture = Gesture.Tap()
    .onBegin(() => {
      "worklet";
      console.log("[CaptionEditor] Tap detected");
    })
    .onEnd((event) => {
      "worklet";
      const tapY = event.y;
      const barHeight = FONT_SIZE * 1.2 + PILL_PADDING_V * 2;

      console.log("[CaptionEditor] Tap ended", {
        x: event.x,
        y: event.y,
        captionCount: captions.length,
        isEditing: !!editingCaptionId,
      });

      if (editingCaptionId) {
        // If we're editing and tap outside the input area, stop editing
        const editingPos = captions.find((c) => c.id === editingCaptionId);
        if (editingPos) {
          const barTop = editingPos.y * containerHeight;
          const barBottom = barTop + barHeight;

          if (tapY < barTop || tapY > barBottom) {
            console.log("[CaptionEditor] Tapped outside, stopping edit");
            runOnJS(onStopEditing)();
            return;
          }
        }
      }

      // Check if tapped on any existing caption
      for (const caption of captions) {
        const barTop = caption.y * containerHeight;
        const barBottom = barTop + barHeight;

        if (tapY >= barTop && tapY <= barBottom) {
          console.log("[CaptionEditor] Tapped on caption", caption.id);
          runOnJS(onStartEditing)(caption.id);
          return;
        }
      }

      // If not editing and didn't tap on any caption, create new one
      if (!editingCaptionId) {
        const normalizedX = event.x / containerWidth;
        const normalizedY = event.y / containerHeight;
        console.log("[CaptionEditor] Creating caption at", {
          normalizedX,
          normalizedY,
        });
        runOnJS(onTapCreate)(normalizedX, normalizedY);
      }
    });

  // Use Exclusive to allow both - pan will block tap if it starts moving
  const composedGesture = Gesture.Exclusive(panGesture, tapGesture);

  // Handle text input changes
  function handleTextChange(text: string) {
    console.log("[CaptionEditor] handleTextChange:", {
      text,
      length: text.length,
      lastChar: text[text.length - 1],
    });
    setInputValue(text);
    if (editingCaption) {
      onUpdate({ ...editingCaption, text });
    }
  }

  // Handle text input submission
  function handleSubmit() {
    inputRef.current?.blur();
    Keyboard.dismiss();
    if (!inputValue.trim() && editingCaption) {
      onDelete(editingCaption.id);
    } else {
      onStopEditing();
    }
  }

  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={StyleSheet.absoluteFill}>
          {/* Render all captions (show if has text or currently editing) */}
          {captions
            .filter((c) => c.text.length > 0 || c.id === editingCaptionId)
            .map((caption) => (
              <AnimatedCaption
                key={caption.id}
                caption={caption}
                containerWidth={containerWidth}
                containerHeight={containerHeight}
                draggingCaptionIdShared={draggingCaptionIdShared}
                translateY={translateY}
                actualYPositions={actualYPositions}
                showCursor={
                  caption.id === editingCaptionId ? showCursor : false
                }
                overrideText={
                  caption.id === editingCaptionId ? inputValue : undefined
                }
                font={font}
              />
            ))}

          {/* Native TextInput for editing - Full width bar */}
          {editingCaption && editingCaptionPosition && (
            <View
              style={[
                styles.inputContainer,
                {
                  top: editingCaptionPosition.y,
                  left: 0,
                  right: 0,
                  width: containerWidth,
                },
              ]}
            >
              <TextInput
                ref={inputRef}
                value={inputValue}
                onChangeText={handleTextChange}
                onSubmitEditing={handleSubmit}
                onBlur={handleSubmit}
                autoFocus
                blurOnSubmit
                multiline={false}
                style={[
                  styles.input,
                  {
                    fontSize: FONT_SIZE,
                    paddingHorizontal: PILL_PADDING_H,
                    paddingVertical: PILL_PADDING_V,
                    width: "100%",
                    opacity: 0, // Invisible - Canvas caption shows the visual
                  },
                ]}
                placeholderTextColor="transparent"
                placeholder=""
                maxLength={280}
              />
            </View>
          )}
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  captionContainer: {
    position: "absolute",
    pointerEvents: "none",
  },
  inputContainer: {
    position: "absolute",
    backgroundColor: "transparent", // Transparent - Canvas caption shows the background
    borderRadius: 0,
  },
  input: {
    color: TEXT_COLOR,
    fontWeight: "bold",
    textAlign: "center",
  },
});

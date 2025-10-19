import type { SharedValue } from "react-native-reanimated";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  InteractionManager,
  Keyboard,
  Platform,
  StyleSheet,
  TextInput,
} from "react-native";
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
  captionHeights: SharedValue<Record<string, number>>;
  font: ReturnType<typeof matchFont> | null;
  showText?: boolean; // If false, only show background
  showBackground?: boolean; // If false, hide background
}

// Animated TextInput wrapper component
interface AnimatedTextInputProps {
  caption: CaptionData;
  containerWidth: number;
  containerHeight: number;
  draggingCaptionIdShared: SharedValue<string | null>;
  translateY: SharedValue<number>;
  actualYPositions: SharedValue<Record<string, number>>;
  captionHeight: number;
  isEditing: boolean;
  setInputRef: (captionId: string) => (ref: TextInput | null) => void;
  onUpdate: (caption: CaptionData) => void;
  onStartEditing: (id: string) => void;
  handleSubmit: () => void;
}

function AnimatedTextInputCaption({
  caption,
  containerWidth,
  containerHeight,
  draggingCaptionIdShared,
  translateY,
  actualYPositions,
  captionHeight,
  isEditing,
  setInputRef,
  onUpdate,
  onStartEditing,
  handleSubmit,
}: AnimatedTextInputProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const isDragging = draggingCaptionIdShared.value === caption.id;
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
      pointerEvents={isEditing ? "auto" : "none"}
      style={[
        styles.inputContainer,
        {
          left: 0,
          right: 0,
          width: containerWidth,
          height: captionHeight,
        },
        animatedStyle,
      ]}
    >
      <TextInput
        key={`${caption.id}-${isEditing ? "editing" : "display"}`}
        ref={setInputRef(caption.id)}
        value={caption.text}
        onFocus={() => {
          if (!isEditing) {
            onStartEditing(caption.id);
          }
        }}
        onChangeText={(text) => {
          onUpdate({ ...caption, text });
        }}
        onSubmitEditing={handleSubmit}
        onBlur={handleSubmit}
        autoFocus={isEditing}
        multiline={true}
        scrollEnabled={false}
        editable={isEditing}
        style={[
          styles.input,
          {
            fontSize: FONT_SIZE,
            height: captionHeight,
            paddingHorizontal: PILL_PADDING_H,
            paddingVertical: PILL_PADDING_V,
            width: "100%",
            textAlignVertical: "top",
          },
        ]}
        maxLength={280}
      />
    </Animated.View>
  );
}

function AnimatedCaption({
  caption,
  containerWidth,
  containerHeight,
  draggingCaptionIdShared,
  translateY,
  actualYPositions,
  captionHeights,
  font,
  showText = true,
  showBackground = true,
}: AnimatedCaptionProps) {
  // Always render but control opacity for instant transitions
  const shouldShow = showText && showBackground;
  // Handle word wrapping using Paragraph API for accurate measurements
  const { displayText } = useMemo(() => {
    if (!font)
      return {
        displayText: caption.text.replace(/ /g, "\u00A0"),
      };

    const maxWidth = containerWidth - PILL_PADDING_H * 2;

    // Split by explicit newlines first to preserve user's line breaks
    const explicitLines = caption.text.split("\n");
    const wrappedLines: string[] = [];

    const paragraphStyle = { textAlign: TextAlign.Left };
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
      fontStyle: { weight: 400 },
    };

    // Process each explicit line for word wrapping
    for (const line of explicitLines) {
      // Handle empty lines (from pressing Enter on empty line)
      if (line.trim() === "") {
        wrappedLines.push("");
        continue;
      }

      const words = line.split(" ");
      let currentLine = "";

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;

        // Use Paragraph API to measure the actual width
        const testParagraph = Skia.ParagraphBuilder.Make(paragraphStyle);
        testParagraph.pushStyle(textStyle);
        testParagraph.addText(testLine);
        testParagraph.pop();
        const p = testParagraph.build();
        p.layout(999999); // Layout without constraint to get natural width
        const testWidth = p.getLongestLine();

        if (testWidth > maxWidth && currentLine) {
          wrappedLines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) wrappedLines.push(currentLine);
    }

    return {
      displayText: wrappedLines.join("\n").replace(/ /g, "\u00A0"),
    };
  }, [caption.text, font, containerWidth]);

  // Create paragraph for proper kerning and text shaping
  const paragraph = useMemo(() => {
    if (!font) return null;

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
        weight: 400, // Normal
      },
    };

    const builder = Skia.ParagraphBuilder.Make(paragraphStyle);
    builder.pushStyle(textStyle);
    builder.addText(displayText);
    builder.pop();
    const p = builder.build();
    p.layout(containerWidth - PILL_PADDING_H * 2); // Layout with padding for proper centering and wrapping
    return p;
  }, [displayText, containerWidth, font]);

  // Calculate height based on paragraph height
  const barHeight = useMemo(() => {
    const minHeight = FONT_SIZE * 1.2 + PILL_PADDING_V * 2;
    if (!paragraph || caption.text.length === 0) {
      captionHeights.value = {
        ...captionHeights.value,
        [caption.id]: minHeight,
      };
      return minHeight;
    }
    const height = Math.max(
      minHeight,
      paragraph.getHeight() + PILL_PADDING_V * 2,
    );
    // Update shared value for gesture detection
    captionHeights.value = {
      ...captionHeights.value,
      [caption.id]: height,
    };
    return height;
  }, [paragraph, caption.id, caption.text.length, captionHeights]);

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
          opacity: shouldShow ? 1 : 0,
        },
        animatedStyle,
      ]}
      pointerEvents="none"
    >
      <Canvas
        style={{
          width: containerWidth,
          height: barHeight,
        }}
      >
        <Group>
          <RoundedRect
            x={0}
            y={0}
            width={containerWidth}
            height={barHeight}
            r={0}
            color={PILL_BG_COLOR}
          />
          {paragraph && (
            <Paragraph
              paragraph={paragraph}
              x={PILL_PADDING_H}
              y={PILL_PADDING_V}
              width={containerWidth - PILL_PADDING_H * 2}
            />
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
  useSkiaRendering?: boolean; // If true, show Skia version; if false, show TextInput
}

const FONT_SIZE = 18;
const PILL_PADDING_H = 12;
const PILL_PADDING_V = 6;
const PILL_BG_COLOR = "rgba(0, 0, 0, 0.6)";
const TEXT_COLOR = "#FFFFFF";
const MARGIN = 20; // Keep caption away from edges
const TOUCH_TARGET_EXPANSION = 10; // Extra pixels for easier touch detection

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
  useSkiaRendering = false,
}: CaptionEditorProps) {
  const editingCaption = captions.find((c) => c.id === editingCaptionId);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const inputRefs = useRef<Map<string, TextInput>>(new Map());

  // Ref callback that stores refs for all captions
  const setInputRef = useCallback(
    (captionId: string) => (ref: TextInput | null) => {
      if (ref) {
        inputRefs.current.set(captionId, ref);
      } else {
        inputRefs.current.delete(captionId);
      }
    },
    [],
  );

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
      fontWeight: "normal",
    });
  }, []);

  // Helper function to calculate caption height
  const calculateCaptionHeight = useCallback(
    (text: string): number => {
      const maxWidth = containerWidth - PILL_PADDING_H * 2;
      const explicitLines = text.split("\n");
      const wrappedLines: string[] = [];

      const paragraphStyle = { textAlign: TextAlign.Center };
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
        fontStyle: { weight: 400 },
      };

      // Process each explicit line for word wrapping
      for (const line of explicitLines) {
        if (line.trim() === "") {
          wrappedLines.push("");
          continue;
        }

        const words = line.split(" ");
        let currentLine = "";

        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;

          const testParagraph = Skia.ParagraphBuilder.Make(paragraphStyle);
          testParagraph.pushStyle(textStyle);
          testParagraph.addText(testLine);
          testParagraph.pop();
          const p = testParagraph.build();
          p.layout(999999);
          const testWidth = p.getLongestLine();

          if (testWidth > maxWidth && currentLine) {
            wrappedLines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
        if (currentLine) wrappedLines.push(currentLine);
      }

      const displayText = wrappedLines.join("\n").replace(/ /g, "\u00A0");

      // Create paragraph to measure height
      const builder = Skia.ParagraphBuilder.Make(paragraphStyle);
      builder.pushStyle(textStyle);
      builder.addText(displayText);
      builder.pop();
      const paragraph = builder.build();
      paragraph.layout(containerWidth - PILL_PADDING_H * 2);

      const minHeight = FONT_SIZE * 1.2 + PILL_PADDING_V * 2;
      return Math.max(minHeight, paragraph.getHeight() + PILL_PADDING_V * 2);
    },
    [containerWidth],
  );

  // Reset translation when not editing
  useEffect(() => {
    if (!editingCaptionId) {
      translateX.value = 0;
      translateY.value = 0;
    }
  }, [editingCaptionId, translateX, translateY]);

  // Focus input when editing starts (for programmatic editing triggers like gesture tap)
  useEffect(() => {
    if (editingCaptionId) {
      // Try to focus immediately
      const ref = inputRefs.current.get(editingCaptionId);
      if (ref) {
        ref.focus();
      } else {
        // If ref doesn't exist yet, wait for next frame
        requestAnimationFrame(() => {
          const ref = inputRefs.current.get(editingCaptionId);
          if (ref) {
            ref.focus();
          } else {
            // Last resort - wait for interactions
            InteractionManager.runAfterInteractions(() => {
              const ref = inputRefs.current.get(editingCaptionId);
              ref?.focus();
            });
          }
        });
      }
    }
  }, [editingCaptionId]);

  // Pan gesture for dragging captions - use shared value for reactive animation
  const draggingCaptionIdShared = useSharedValue<string | null>(null);
  // Store actual Y positions that update synchronously during drag
  const actualYPositions = useSharedValue<Record<string, number>>({});
  // Store caption heights for gesture detection
  const captionHeights = useSharedValue<Record<string, number>>({});

  // Initialize actualYPositions from captions
  useEffect(() => {
    const positions: Record<string, number> = {};
    captions.forEach((caption) => {
      positions[caption.id] = caption.y;
    });
    actualYPositions.value = positions;
  }, [captions, actualYPositions]);

  // Update caption heights for gesture detection
  useEffect(() => {
    const heights: Record<string, number> = {};
    captions
      .filter((c) => c.text.length > 0 || c.id === editingCaptionId)
      .forEach((caption) => {
        const captionHeight = calculateCaptionHeight(caption.text);
        heights[caption.id] = captionHeight;
      });
    captionHeights.value = heights;
  }, [
    captions,
    editingCaptionId,
    containerWidth,
    captionHeights,
    calculateCaptionHeight,
  ]);

  const panGesture = Gesture.Pan()
    .enabled(!editingCaptionId) // Only allow dragging when not editing
    .onStart((event) => {
      "worklet";
      // Find which caption we're dragging
      const tapY = event.y;

      for (const caption of captions) {
        const barHeight =
          captionHeights.value[caption.id] ??
          FONT_SIZE * 1.2 + PILL_PADDING_V * 2;
        // Use actualYPositions if available, otherwise use caption.y
        const actualY = actualYPositions.value[caption.id] ?? caption.y;
        const barTop = actualY * containerHeight - TOUCH_TARGET_EXPANSION;
        const barBottom = barTop + barHeight + TOUCH_TARGET_EXPANSION * 2;

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
      const barHeight =
        captionHeights.value[draggedCaptionId] ??
        FONT_SIZE * 1.2 + PILL_PADDING_V * 2;
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
  const tapGesture = Gesture.Tap().onEnd((event) => {
    "worklet";
    const tapY = event.y;

    if (editingCaptionId) {
      // If we're editing and tap outside the input area, stop editing
      const editingPos = captions.find((c) => c.id === editingCaptionId);
      if (editingPos) {
        const barHeight =
          captionHeights.value[editingPos.id] ??
          FONT_SIZE * 1.2 + PILL_PADDING_V * 2;
        const actualY = actualYPositions.value[editingPos.id] ?? editingPos.y;
        const barTop = actualY * containerHeight - TOUCH_TARGET_EXPANSION;
        const barBottom = barTop + barHeight + TOUCH_TARGET_EXPANSION * 2;

        if (tapY < barTop || tapY > barBottom) {
          runOnJS(handleSubmit)();
          return;
        }
      }
    }

    // Check if tapped on any existing caption
    for (const caption of captions) {
      const barHeight =
        captionHeights.value[caption.id] ??
        FONT_SIZE * 1.2 + PILL_PADDING_V * 2;
      const actualY = actualYPositions.value[caption.id] ?? caption.y;
      const barTop = actualY * containerHeight - TOUCH_TARGET_EXPANSION;
      const barBottom = barTop + barHeight + TOUCH_TARGET_EXPANSION * 2;

      if (tapY >= barTop && tapY <= barBottom) {
        runOnJS(onStartEditing)(caption.id);
        return;
      }
    }

    // If not editing and didn't tap on any caption, create new one
    if (!editingCaptionId) {
      const normalizedX = event.x / containerWidth;
      const normalizedY = event.y / containerHeight;
      runOnJS(onTapCreate)(normalizedX, normalizedY);
    }
  });

  // Use Exclusive to allow both - pan will block tap if it starts moving
  const composedGesture = Gesture.Exclusive(panGesture, tapGesture);

  // Handle text input submission
  function handleSubmit() {
    if (editingCaptionId) {
      inputRefs.current.get(editingCaptionId)?.blur();
    }
    Keyboard.dismiss();
    if (editingCaption && !editingCaption.text.trim()) {
      onDelete(editingCaption.id);
    } else {
      onStopEditing();
    }
  }

  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={StyleSheet.absoluteFill}>
          {/* Render all captions with their TextInputs */}
          {captions
            .filter((c) => c.text.length > 0 || c.id === editingCaptionId)
            .map((caption) => {
              const isEditing = caption.id === editingCaptionId;
              const captionHeight = calculateCaptionHeight(caption.text);

              return (
                <React.Fragment key={caption.id}>
                  {/* Skia caption background + text - only show when useSkiaRendering is true AND not editing */}
                  {useSkiaRendering && !isEditing && (
                    <AnimatedCaption
                      caption={caption}
                      containerWidth={containerWidth}
                      containerHeight={containerHeight}
                      draggingCaptionIdShared={draggingCaptionIdShared}
                      translateY={translateY}
                      actualYPositions={actualYPositions}
                      captionHeights={captionHeights}
                      font={font}
                      showText={true}
                      showBackground={true}
                    />
                  )}

                  {/* TextInput overlay - show when not using Skia rendering OR when actively editing */}
                  {(!useSkiaRendering || isEditing) && (
                    <AnimatedTextInputCaption
                      caption={caption}
                      containerWidth={containerWidth}
                      containerHeight={containerHeight}
                      draggingCaptionIdShared={draggingCaptionIdShared}
                      translateY={translateY}
                      actualYPositions={actualYPositions}
                      captionHeight={captionHeight}
                      isEditing={isEditing}
                      setInputRef={setInputRef}
                      onUpdate={onUpdate}
                      onStartEditing={onStartEditing}
                      handleSubmit={handleSubmit}
                    />
                  )}
                </React.Fragment>
              );
            })}
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
    backgroundColor: "transparent",
    borderRadius: 0,
  },
  input: {
    color: TEXT_COLOR,
    fontWeight: "normal",
    textAlign: "center",
    backgroundColor: PILL_BG_COLOR,
  },
});

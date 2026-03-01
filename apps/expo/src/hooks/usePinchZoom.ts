import { Gesture } from "react-native-gesture-handler";
import {
  Extrapolate,
  interpolate,
  useSharedValue,
} from "react-native-reanimated";

const SCALE_FULL_ZOOM = 3;

export function usePinchZoom(
  zoom: { value: number },
  minZoom: number,
  maxZoom: number,
) {
  const startZoom = useSharedValue(1);

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      "worklet";
      startZoom.value = zoom.value;
    })
    .onUpdate((event) => {
      "worklet";
      const scale = interpolate(
        event.scale,
        [1 - 1 / SCALE_FULL_ZOOM, 1, SCALE_FULL_ZOOM],
        [-1, 0, 1],
        Extrapolate.CLAMP,
      );
      zoom.value = interpolate(
        scale,
        [-1, 0, 1],
        [minZoom, startZoom.value, maxZoom],
        Extrapolate.CLAMP,
      );
    });

  return { pinchGesture };
}

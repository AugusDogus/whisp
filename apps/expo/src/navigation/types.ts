import type { ParamListBase } from "@react-navigation/native";

export interface RootStackParamList extends ParamListBase {
  Splash: undefined;
  Login: undefined;
  Onboarding: undefined;
  Main: { screen?: string; params?: Record<string, unknown> } | undefined;
  Post: { id: string };
  Media: { path: string; type: "photo" | "video"; defaultRecipientId?: string };
}

export type AppScreenName = keyof RootStackParamList;

export interface MainTabParamList extends ParamListBase {
  Friends:
    | {
        path?: string;
        type?: "photo" | "video";
        defaultRecipientId?: string;
        openMessageFromSender?: string;
        rasterizationPromise?: Promise<string>; // Promise that resolves to rasterized image path
        captions?: {
          id: string;
          text: string;
          x: number;
          y: number;
          fontSize: number;
          color: string;
        }[];
        originalWidth?: number; // Original image width for proper caption scaling
        originalHeight?: number; // Original image height for proper caption scaling
        instantMessage?: {
          messageId: string;
          senderId: string;
          fileUrl: string;
          mimeType: string;
          thumbhash?: string;
          deliveryId: string;
        };
      }
    | undefined;
  Camera: { defaultRecipientId?: string } | undefined;
  Profile: undefined;
}

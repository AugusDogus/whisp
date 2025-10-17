import type { ParamListBase } from "@react-navigation/native";

import type { Annotation } from "@acme/validators";

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
        annotations?: Annotation[];
        openMessageFromSender?: string;
        instantMessage?: {
          messageId: string;
          senderId: string;
          fileUrl: string;
          mimeType: string;
          thumbhash?: string;
          annotations?: string;
          deliveryId: string;
        };
      }
    | undefined;
  Camera: { defaultRecipientId?: string } | undefined;
  Profile: undefined;
}

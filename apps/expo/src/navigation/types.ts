import type { ParamListBase } from "@react-navigation/native";

export interface RootStackParamList extends ParamListBase {
  Splash: undefined;
  Login: undefined;
  Main: undefined;
  AddFriends: undefined;
  Post: { id: string };
  Media: { path: string; type: "photo" | "video"; defaultRecipientId?: string };
  Friends: {
    path: string;
    type: "photo" | "video";
    defaultRecipientId?: string;
  };
}

export type AppScreenName = keyof RootStackParamList;

export interface MainTabParamList extends ParamListBase {
  Inbox: undefined;
  Camera: { defaultRecipientId?: string } | undefined;
}

import type { ParamListBase } from "@react-navigation/native";

export interface RootStackParamList extends ParamListBase {
  Splash: undefined;
  Login: undefined;
  Camera: undefined;
  Post: { id: string };
  Media: { path: string; type: "photo" | "video" };
  Friends: { path: string; type: "photo" | "video" };
}

export type AppScreenName = keyof RootStackParamList;

import type { ParamListBase } from "@react-navigation/native";

export interface RootStackParamList extends ParamListBase {
  Splash: undefined;
  Login: undefined;
  Camera: undefined;
  Post: { id: string };
}

export type AppScreenName = keyof RootStackParamList;

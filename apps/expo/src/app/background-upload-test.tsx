import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";

import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";

import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Button } from "heroui-native/button";

import { SafeAreaView } from "~/components/styled";
import { Text } from "~/components/ui/text";
import type { RootStackParamList } from "~/navigation/types";
import { trpc } from "~/utils/api";
import {
  createFile,
  listBackgroundUploadTasks,
  type BackgroundUploadTask,
  uploadFilesWithInputInBackground,
} from "~/utils/uploadthing";

const isBackgroundUploadTestEnabled =
  process.env.EXPO_PUBLIC_ENABLE_BACKGROUND_UPLOAD_TEST_PAGE === "true";

type LogEntry = {
  id: string;
  message: string;
};

function makeLogEntry(message: string): LogEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message: `${new Date().toLocaleTimeString()} • ${message}`,
  };
}

export default function BackgroundUploadTestScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [nativeTasks, setNativeTasks] = useState<BackgroundUploadTask[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const previousTaskStates = useRef<Map<string, string>>(new Map());

  const uploadsQuery = trpc.backgroundUploadTest.list.useQuery(undefined, {
    enabled: isBackgroundUploadTestEnabled,
    refetchInterval: 3_000,
  });

  const deleteUpload = trpc.backgroundUploadTest.delete.useMutation({
    onSuccess: async (result, variables) => {
      if (!result.ok) {
        appendLog(
          result.reason === "not_found"
            ? `Uploaded file ${variables.id} was already removed.`
            : `Delete skipped for uploaded file ${variables.id}.`,
        );
        await uploadsQuery.refetch();
        return;
      }

      appendLog(`Deleted uploaded file ${variables.id}.`);
      await uploadsQuery.refetch();
    },
    onError: (error) => {
      appendLog(`Delete failed: ${error.message}`);
    },
  });

  function appendLog(message: string) {
    console.log(`[BackgroundUploadTest] ${message}`);
    setLogs((current) => [makeLogEntry(message), ...current].slice(0, 100));
  }

  const refreshNativeTasks = useCallback(async () => {
    try {
      const tasks = await listBackgroundUploadTasks();
      setNativeTasks(tasks);
      const nextStates = new Map<string, string>();
      for (const task of tasks) {
        nextStates.set(
          task.taskId,
          `${task.status}:${task.bytesSent}:${task.totalBytes}`,
        );
        const previousState = previousTaskStates.current.get(task.taskId);
        const currentState = `${task.status}:${task.bytesSent}:${task.totalBytes}`;
        if (previousState !== currentState) {
          const progress =
            task.totalBytes > 0
              ? ` (${Math.round((task.bytesSent / task.totalBytes) * 100)}%)`
              : "";
          appendLog(
            `Task ${task.taskId.slice(0, 8)} → ${task.status}${progress}`,
          );
        }
      }
      previousTaskStates.current = nextStates;
    } catch (error) {
      appendLog(
        `Failed to read native background tasks: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }, []);

  useEffect(() => {
    if (!isBackgroundUploadTestEnabled) {
      return;
    }

    let isMounted = true;

    async function refreshNativeTasksWithMountGuard() {
      try {
        const tasks = await listBackgroundUploadTasks();
        if (!isMounted) return;

        setNativeTasks(tasks);
        const nextStates = new Map<string, string>();
        for (const task of tasks) {
          nextStates.set(
            task.taskId,
            `${task.status}:${task.bytesSent}:${task.totalBytes}`,
          );
          const previousState = previousTaskStates.current.get(task.taskId);
          const currentState = `${task.status}:${task.bytesSent}:${task.totalBytes}`;
          if (previousState !== currentState) {
            const progress =
              task.totalBytes > 0
                ? ` (${Math.round((task.bytesSent / task.totalBytes) * 100)}%)`
                : "";
            appendLog(
              `Task ${task.taskId.slice(0, 8)} → ${task.status}${progress}`,
            );
          }
        }
        previousTaskStates.current = nextStates;
      } catch (error) {
        if (!isMounted) return;
        appendLog(
          `Failed to read native background tasks: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }

    void refreshNativeTasksWithMountGuard();
    const interval = setInterval(() => {
      void refreshNativeTasksWithMountGuard();
    }, 1_500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await Promise.all([uploadsQuery.refetch(), refreshNativeTasks()]);
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handlePickMedia() {
    try {
      setIsUploading(true);
      appendLog("Opening media picker…");

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsMultipleSelection: true,
        quality: 1,
        selectionLimit: 10,
      });

      if (result.canceled) {
        appendLog("Media picker cancelled.");
        return;
      }

      appendLog(`Preparing ${result.assets.length} file(s) for upload…`);
      const files = await Promise.all(
        result.assets.map((asset) =>
          createFile(asset.uri, asset.type === "video" ? "video" : "photo"),
        ),
      );

      const batch = await uploadFilesWithInputInBackground(
        "backgroundUploadTestUploader",
        {
          files,
          input: {},
          notificationTitle: "Testing background uploads",
          notificationBody: `Uploading ${files.length} file(s) in the background`,
        },
      );

      appendLog(
        `Queued ${batch.tasks.length} background upload task(s): ${batch.tasks
          .map((task) => task.taskId.slice(0, 8))
          .join(", ")}`,
      );

      void batch.completion
        .then(async (tasks) => {
          const failedTask = tasks.find((task) => task.status !== "completed");
          if (failedTask) {
            appendLog(
              `Background upload failed: ${failedTask.errorMessage ?? failedTask.status}`,
            );
          } else {
            appendLog(
              `Background upload batch completed (${tasks.length} file(s)).`,
            );
          }
          await uploadsQuery.refetch();
        })
        .catch((error) => {
          appendLog(
            `Background completion watcher failed: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
        });
    } catch (error) {
      appendLog(
        `Failed to start test upload: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    } finally {
      setIsUploading(false);
    }
  }

  const uploadedFiles = uploadsQuery.data ?? [];
  const hasUploadedFiles = uploadedFiles.length > 0;
  const hasNativeTasks = nativeTasks.length > 0;

  const sectionTitleClassName = useMemo(
    () => "pb-2 text-sm font-semibold uppercase tracking-wide text-muted",
    [],
  );

  if (!isBackgroundUploadTestEnabled) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-center text-lg font-semibold">
          Background upload test page is disabled
        </Text>
        <Text className="mt-2 text-center text-sm text-muted">
          Set EXPO_PUBLIC_ENABLE_BACKGROUND_UPLOAD_TEST_PAGE=true and
          ENABLE_BACKGROUND_UPLOAD_TEST_PAGE=true to enable this screen.
        </Text>
        <Button className="mt-6" onPress={() => navigation.goBack()}>
          Back
        </Button>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable onPress={() => navigation.goBack()} className="p-2">
          <Ionicons name="chevron-back" size={24} color="white" />
        </Pressable>
        <Text className="text-lg font-semibold">Background Upload Test</Text>
        <View className="w-10" />
      </View>

      <ScrollView
        className="flex-1 px-4"
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      >
        <View className="gap-4 pb-8">
          <View className="bg-surface rounded-xl p-4">
            <Text className="text-base font-semibold">
              Test background uploads without sending whisps
            </Text>
            <Text className="mt-2 text-sm text-muted">
              Pick images or videos, queue them through the background-upload
              module, inspect native task logs, and delete uploaded test files
              when you are done.
            </Text>
            <View className="mt-4 gap-3">
              <Button
                onPress={() => void handlePickMedia()}
                isDisabled={isUploading}
              >
                {isUploading ? "Preparing Upload…" : "Pick Media to Upload"}
              </Button>
              <Button
                variant="secondary"
                onPress={() => void handleRefresh()}
                isDisabled={isRefreshing}
              >
                Refresh Upload State
              </Button>
            </View>
          </View>

          <View>
            <Text className={sectionTitleClassName}>
              Native background tasks
            </Text>
            <View className="gap-3">
              {hasNativeTasks ? (
                nativeTasks.map((task) => {
                  const progress =
                    task.totalBytes > 0
                      ? Math.min(1, task.bytesSent / task.totalBytes)
                      : 0;
                  return (
                    <View
                      key={task.taskId}
                      className="bg-surface rounded-xl p-4"
                    >
                      <Text className="text-sm font-semibold">
                        {task.fileName}
                      </Text>
                      <Text className="mt-1 text-xs text-muted">
                        {task.taskId}
                      </Text>
                      <Text className="mt-2 text-sm">
                        Status: {task.status}
                      </Text>
                      <View className="bg-default mt-3 h-2 overflow-hidden rounded-full">
                        <View
                          className="h-full bg-primary"
                          style={{ width: `${Math.round(progress * 100)}%` }}
                        />
                      </View>
                      <Text className="mt-2 text-xs text-muted">
                        {Math.round(task.bytesSent)} /{" "}
                        {Math.round(task.totalBytes)} bytes
                      </Text>
                      {task.errorMessage ? (
                        <Text className="text-danger mt-2 text-xs">
                          {task.errorMessage}
                        </Text>
                      ) : null}
                    </View>
                  );
                })
              ) : (
                <View className="bg-surface rounded-xl p-4">
                  <Text className="text-sm text-muted">
                    No native background upload tasks yet.
                  </Text>
                </View>
              )}
            </View>
          </View>

          <View>
            <Text className={sectionTitleClassName}>Uploaded test files</Text>
            <View className="gap-3">
              {hasUploadedFiles ? (
                uploadedFiles.map((file) => {
                  const isImage = file.mimeType?.startsWith("image/");
                  return (
                    <View key={file.id} className="bg-surface rounded-xl p-4">
                      {isImage ? (
                        <Image
                          source={{ uri: file.fileUrl }}
                          style={{
                            width: "100%",
                            height: 180,
                            borderRadius: 12,
                          }}
                          contentFit="cover"
                        />
                      ) : (
                        <View className="mb-3 flex-row items-center gap-2">
                          <Ionicons
                            name="document-outline"
                            size={18}
                            color="white"
                          />
                          <Text className="text-sm text-muted">
                            {file.mimeType ?? "Unknown file type"}
                          </Text>
                        </View>
                      )}
                      <Text className="mt-3 text-sm font-semibold">
                        {file.originalFileName}
                      </Text>
                      <Text className="mt-1 text-xs text-muted">
                        Uploaded {new Date(file.createdAt).toLocaleString()}
                      </Text>
                      <View className="mt-3 flex-row gap-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          onPress={() => {
                            appendLog(`Opening uploaded file ${file.id}.`);
                            void Linking.openURL(file.fileUrl);
                          }}
                        >
                          Open
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onPress={() => {
                            appendLog(`Deleting uploaded file ${file.id}…`);
                            deleteUpload.mutate({ id: file.id });
                          }}
                          isDisabled={deleteUpload.isPending}
                        >
                          Delete
                        </Button>
                      </View>
                    </View>
                  );
                })
              ) : (
                <View className="bg-surface rounded-xl p-4">
                  <Text className="text-sm text-muted">
                    No uploaded test files yet.
                  </Text>
                </View>
              )}
            </View>
          </View>

          <View>
            <Text className={sectionTitleClassName}>Logs</Text>
            <View className="bg-surface rounded-xl p-4">
              {logs.length > 0 ? (
                logs.map((log) => (
                  <Text key={log.id} className="pb-2 text-xs text-muted">
                    {log.message}
                  </Text>
                ))
              ) : (
                <Text className="text-sm text-muted">
                  No logs yet. Start a test upload to record activity.
                </Text>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

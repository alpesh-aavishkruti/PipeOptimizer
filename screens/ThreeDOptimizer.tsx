import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useRef, useState } from "react";
import Constants from "expo-constants";

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  StatusBar,
  TextInput,
  Pressable,
  Keyboard,
  Image,
  TouchableOpacity,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { MaterialIcons } from "@expo/vector-icons";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
const API_BASE_URL = Constants.expoConfig?.extra?.API_BASE_URL ?? "";
const API_KEY = Constants.expoConfig?.extra?.API_KEY ?? "";
// Define types

type GlassSheet = {
  length: number;
  width: number;
  stock: number;
};

type OrderPiece = {
  length: number;
  width: number;
  quantity: number;
};

type OptimizedSheet = {
  sheetSize: { length: number; width: number };
  remaining: { length: number; width: number };
  cuts: Array<{ length: number; width: number }>;
  count: number;
  efficiency: number;
};

const call2DOptimizationAPI = async (
  availableSheets: GlassSheet[],
  demandList: OrderPiece[]
): Promise<OptimizedSheet[]> => {
  try {
    const stock = availableSheets.flatMap((sheet) =>
      Array(sheet.stock)
        .fill(0)
        .map((_, i) => ({
          w: sheet.width,
          h: sheet.length,
          id: `sheet_${sheet.length}x${sheet.width}_${i}`,
        }))
    );

    // Format pieces for API
    const pieces = demandList.flatMap((piece) =>
      Array(piece.quantity)
        .fill(0)
        .map((_, i) => ({
          w: piece.width,
          h: piece.length,
          id: `piece_${piece.length}x${piece.width}_${i}`,
        }))
    );

    console.log("pieces:", pieces);

    const requestBody = {
      stock: stock, 
      pieces: pieces,
    };

    console.log("Request body:", JSON.stringify(requestBody, null, 2));

    const response = await fetch(
      `${API_BASE_URL}/api/calcuta/2d-optimization/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        },
        body: JSON.stringify(requestBody),
      }
    );

    console.log("API response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error response:", errorText);
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log("API response data:", data);
    return mapApiResponseToOptimizedSheets(data);
  } catch (error) {
    console.error("API call failed:", error);
    throw error;
  }
};

const mapApiResponseToOptimizedSheets = (
  apiResponse: any
): OptimizedSheet[] => {
  const optimizedSheets: OptimizedSheet[] = [];

  if (!apiResponse.sheets || !Array.isArray(apiResponse.sheets)) {
    console.error("Invalid API response structure:", apiResponse);
    return optimizedSheets;
  }

  const layoutGroups: { [key: string]: OptimizedSheet } = {};

  apiResponse.sheets.forEach((sheet: any) => {
    const cuts = sheet.pieces.map((piece: any) => ({
      length: piece.h,
      width: piece.w,
      x: piece.x, 
      y: piece.y,
    }));

    const cutsSignature = cuts
      .map((c) => `${c.length}x${c.width}`)
      .sort()
      .join("|");

    const signature = `${sheet.size.w}x${sheet.size.h}|${cutsSignature}`;

    if (!layoutGroups[signature]) {
      const usedArea = cuts.reduce(
        (sum:any, cut:any) => sum + cut.length * cut.width,
        0
      );
      const totalArea = sheet.size.w * sheet.size.h;
      const efficiency = totalArea > 0 ? (usedArea / totalArea) * 100 : 0;

      layoutGroups[signature] = {
        sheetSize: {
          length: sheet.size.h,
          width: sheet.size.w,
        },
        cuts: cuts,
        remaining: {
          length: 0,
          width: 0,
        },
        count: 0,
        efficiency: efficiency,
      };
    }

    layoutGroups[signature].count++;
  });

  return Object.values(layoutGroups);
};

const MetricCard = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.metricCard}>
    <Text style={styles.metricLabel}>{label}</Text>
    <Text style={styles.metricValue}>{value}</Text>
  </View>
);

export default function ThreeDOptimizer() {
  const [orderPieces, setOrderPieces] = useState<OrderPiece[]>([]);
  const [lengthInput, setLengthInput] = useState<string>("");
  const [widthInput, setWidthInput] = useState<string>("");
  const [sheetLengthInput, setSheetLengthInput] = useState<string>("");
  const [sheetWidthInput, setSheetWidthInput] = useState<string>("");
  const [stockInput, setStockInput] = useState<string>("");
  const [quantityInput, setQuantityInput] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"sheets" | "calculator">("sheets");
  const [availableSheets, setAvailableSheets] = useState<GlassSheet[]>([]);
  const [optimized, setOptimized] = useState<OptimizedSheet[]>([]);
  const [totalPiecesNeeded, setTotalPiecesNeeded] = useState(0);
  const [totalPiecesCut, setTotalPiecesCut] = useState(0);
  const viewRef = useRef<View>(null);
  console.log(optimized, "sdfbsdhjfbsdf");
  useEffect(() => {
    const loadSheets = async () => {
      try {
        const stored = await AsyncStorage.getItem("availableSheets");
        if (stored) {
          setAvailableSheets(JSON.parse(stored));
        }
      } catch (e) {
        console.error("Failed to load sheets", e);
      }
    };

    loadSheets();
  }, []);

  useEffect(() => {
    const saveSheets = async () => {
      try {
        await AsyncStorage.setItem(
          "availableSheets",
          JSON.stringify(availableSheets)
        );
      } catch (e) {
        console.error("Failed to save sheets", e);
      }
    };

    saveSheets();
  }, [availableSheets]);

  const optimizeGlass = async () => {
    if (orderPieces.length === 0) {
      console.log("No order pieces to optimize");
      return;
    }

    if (availableSheets.length === 0) {
      console.log("No available sheets for optimization");
      return;
    }

    const demandList = orderPieces
      .filter((piece) => piece.quantity > 0)
      .map((piece) => ({ ...piece }));

    if (demandList.length === 0) {
      console.log("No pieces with quantity > 0");
      return;
    }

    const sheetsCopy = JSON.parse(JSON.stringify(availableSheets));

    try {
      const optimizedResult = await call2DOptimizationAPI(
        sheetsCopy,
        demandList
      );
      setOptimized(optimizedResult);

      // Calculate totals
      const totalNeeded = demandList.reduce(
        (sum, piece) => sum + piece.quantity,
        0
      );
      const totalCut = optimizedResult.reduce(
        (sum, sheet) => sum + sheet.cuts.length * sheet.count,
        0
      );

      setTotalPiecesNeeded(totalNeeded);
      setTotalPiecesCut(totalCut);
    } catch (error) {
      console.error("Optimization failed:", error);
      // Handle error (e.g., show alert to user)
    }
  };

  const resetAll = () => {
    setOrderPieces([]);
    setLengthInput("");
    setWidthInput("");
    setSheetLengthInput("");
    setSheetWidthInput("");
    setQuantityInput("");
    setStockInput("");
    setOptimized([]);
    setAvailableSheets([]);
    setTotalPiecesNeeded(0);
    setTotalPiecesCut(0);
  };

  const removeSheet = (length: number, width: number) => {
    setAvailableSheets((prev) =>
      prev.filter(
        (sheet) => !(sheet.length === length && sheet.width === width)
      )
    );
  };

  const removeOrderPiece = (indexToRemove: number) => {
    setOrderPieces((prev) =>
      prev.filter((_, index) => index !== indexToRemove)
    );
  };

  const getCutCounts = (cuts: Array<{ length: number; width: number }>) => {
    return cuts.reduce((acc, cut) => {
      const key = `${cut.length}x${cut.width}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  };

  const shareResults = async () => {
    try {
      if (!viewRef.current) return;
      const uri = await captureRef(viewRef, {
        format: "png",
        quality: 1,
      });
      await Sharing.shareAsync(uri);
    } catch (error) {
      console.error("Error sharing results:", error);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#1a365d" />

      {/* Header */}
      <View style={styles.headerContainer}>
        <View style={styles.headerBackground}>
          <View style={styles.titleContainer}>
            <Image
              source={require("../assets/aavishkruti-logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <Pressable
          style={({ pressed }) => [
            styles.tab,
            activeTab === "sheets" && styles.tabActive,
            pressed && styles.tabPressed,
          ]}
          onPress={() => setActiveTab("sheets")}
        >
          <View style={styles.tabContent}>
            <Svg
              width={20}
              height={20}
              viewBox="0 0 24 24"
              style={styles.tabIcon}
            >
              <Path
                d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
                fill={activeTab === "sheets" ? "#fff" : "#f97316"}
              />
              <Path
                d="M8 8h8v8H8z"
                fill={activeTab === "sheets" ? "#fff" : "#f97316"}
              />
            </Svg>
            <Text
              style={[
                styles.tabtext,
                activeTab === "sheets" && styles.tabtextActive,
              ]}
            >
              Glass Sheets
            </Text>
          </View>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.tab,
            activeTab === "calculator" && styles.tabActive,
            pressed && styles.tabPressed,
          ]}
          onPress={() => setActiveTab("calculator")}
        >
          <View style={styles.tabContent}>
            <Svg
              width={20}
              height={20}
              viewBox="0 0 24 24"
              style={styles.tabIcon}
            >
              <Path
                d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"
                fill={activeTab === "calculator" ? "#fff" : "#f97316"}
              />
              <Path
                d="M8 8h2v2H8zm4 0h2v2h-2zm-4 4h2v2H8zm4 0h2v2h-2zm-4 4h2v2H8zm4 0h2v2h-2zm4-8h2v2h-2zm0 4h2v2h-2zm0 4h2v2h-2z"
                fill={activeTab === "calculator" ? "#fff" : "#f97316"}
              />
            </Svg>
            <Text
              style={[
                styles.tabtext,
                activeTab === "calculator" && styles.tabtextActive,
              ]}
            >
              Calculator
            </Text>
          </View>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === "sheets" && (
          <View style={styles.section}>
            <View style={styles.inputCard}>
              <View style={styles.inputRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Sheet Length (inch)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g., 2440"
                    value={sheetLengthInput}
                    keyboardType="numeric"
                    onChangeText={setSheetLengthInput}
                  />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Sheet Width (inch)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g., 1220"
                    value={sheetWidthInput}
                    keyboardType="numeric"
                    onChangeText={setSheetWidthInput}
                  />
                </View>
              </View>
              <View style={styles.inputRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Stock Quantity</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g., 10"
                    value={stockInput}
                    keyboardType="numeric"
                    onChangeText={setStockInput}
                  />
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.addButton,
                  pressed && styles.addButtonPressed,
                ]}
                onPress={() => {
                  Keyboard.dismiss();
                  const length = parseInt(sheetLengthInput);
                  const width = parseInt(sheetWidthInput);
                  const stock = parseInt(stockInput);

                  if (
                    !isNaN(length) &&
                    !isNaN(width) &&
                    !isNaN(stock) &&
                    length > 0 &&
                    width > 0 &&
                    stock > 0
                  ) {
                    setAvailableSheets((prev) => {
                      const existingIndex = prev.findIndex(
                        (s) => s.length === length && s.width === width
                      );
                      if (existingIndex !== -1) {
                        const updated = [...prev];
                        updated[existingIndex].stock += stock;
                        return updated;
                      } else {
                        return [...prev, { length, width, stock }];
                      }
                    });
                    setSheetLengthInput("");
                    setSheetWidthInput("");
                    setStockInput("");
                  }
                }}
              >
                <View style={styles.addButtonContent}>
                  <Text style={styles.addButtonIcon}>+</Text>
                  <Text style={styles.addButtonText}>Add Sheet</Text>
                </View>
              </Pressable>
            </View>

            <View style={styles.tableContainer}>
              {availableSheets.length === 0 ? (
                <View style={styles.emptyState}>
                  <View style={styles.emptyStateIconContainer}>
                    <Text style={styles.emptyStateIcon}>📦</Text>
                  </View>
                  <Text style={styles.emptyStateText}>
                    No glass sheets in inventory
                  </Text>
                  <Text style={styles.emptyStateSubtext}>
                    Add sheets using the form above
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.tableHeader}>
                    <Text style={styles.tableHeaderText}>Size (inch)</Text>
                    <Text style={styles.tableHeaderText}>Stock</Text>
                    <Text style={styles.tableHeaderText}>Action</Text>
                  </View>

                  {availableSheets.map((sheet, index) => (
                    <View key={index} style={styles.tableRow}>
                      <View style={styles.tableCell}>
                        <Text style={styles.tableCellText}>
                          {sheet.length}×{sheet.width}
                        </Text>
                      </View>
                      <View style={styles.tableCell}>
                        <View style={styles.stockBadge}>
                          <Text style={styles.stockBadgeText}>
                            {sheet.stock}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.tableCell}>
                        <Pressable
                          style={({ pressed }) => [
                            pressed && styles.deleteButtonPressed,
                          ]}
                          onPress={() => removeSheet(sheet.length, sheet.width)}
                        >
                          <Text style={styles.deleteButtonIcon}>🗑️</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </>
              )}
            </View>
          </View>
        )}

        {activeTab === "calculator" && (
          <View style={styles.section}>
            <View style={styles.inputCard}>
              <View style={styles.inputRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Piece Length (inch)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g., 600"
                    value={lengthInput}
                    keyboardType="numeric"
                    onChangeText={setLengthInput}
                  />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Piece Width (inch)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g., 400"
                    value={widthInput}
                    keyboardType="numeric"
                    onChangeText={setWidthInput}
                  />
                </View>
              </View>
              <View style={styles.inputRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Quantity</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g., 5"
                    value={quantityInput}
                    keyboardType="numeric"
                    onChangeText={setQuantityInput}
                  />
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.addButton,
                  pressed && styles.addButtonPressed,
                ]}
                onPress={() => {
                  const length = parseInt(lengthInput);
                  const width = parseInt(widthInput);
                  const quantity = parseInt(quantityInput);
                  if (
                    !isNaN(length) &&
                    !isNaN(width) &&
                    !isNaN(quantity) &&
                    length > 0 &&
                    width > 0 &&
                    quantity > 0
                  ) {
                    setOrderPieces([
                      ...orderPieces,
                      { length, width, quantity },
                    ]);
                    setLengthInput("");
                    setWidthInput("");
                    setQuantityInput("");
                  }
                }}
              >
                <View style={styles.addButtonContent}>
                  <Text style={styles.addButtonIcon}>+</Text>
                  <Text style={styles.addButtonText}>Add Piece</Text>
                </View>
              </Pressable>
            </View>

            <View style={styles.tableContainer}>
              {orderPieces.length === 0 ? (
                <View style={styles.emptyState}>
                  <View style={styles.emptyStateIconContainer}>
                    <Text style={styles.emptyStateIcon}>✂️</Text>
                  </View>
                  <Text style={styles.emptyStateText}>
                    No cutting requirements
                  </Text>
                  <Text style={styles.emptyStateSubtext}>
                    Add glass pieces to cut above
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.tableHeader}>
                    <Text style={styles.tableHeaderText}>Size (inch)</Text>
                    <Text style={styles.tableHeaderText}>Qty</Text>
                    <Text style={styles.tableHeaderText}></Text>
                  </View>

                  {orderPieces.map((item, index) => (
                    <View key={index} style={styles.tableRow}>
                      <View style={styles.tableCell}>
                        <Text style={styles.tableCellText}>
                          {item.length}×{item.width}
                        </Text>
                      </View>
                      <View style={styles.tableCell}>
                        <View style={styles.quantityBadge}>
                          <Text style={styles.quantityBadgeText}>
                            {item.quantity}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.tableCell}>
                        <Pressable
                          style={({ pressed }) => [
                            pressed && styles.deleteButtonPressed,
                          ]}
                          onPress={() => removeOrderPiece(index)}
                        >
                          <Text style={styles.deleteButtonIcon}>🗑️</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </>
              )}
            </View>
          </View>
        )}

        <View style={styles.actionButtons}>
          {activeTab === "calculator" && (
            <Pressable
              style={({ pressed }) => [
                styles.optimizeButton,
                orderPieces.length === 0 && styles.buttonDisabled,
                pressed && styles.optimizeButtonPressed,
              ]}
              onPress={optimizeGlass}
              disabled={orderPieces.length === 0}
            >
              <View style={styles.buttonContent}>
                <Text style={styles.optimizeButtonIcon}>✂️</Text>
                <Text style={styles.optimizeButtonText}>Optimize Cuts</Text>
              </View>
            </Pressable>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.resetButton,
              pressed && styles.resetButtonPressed,
            ]}
            onPress={resetAll}
          >
            <View style={styles.buttonContent}>
              <Text style={styles.resetButtonIcon}>🔄</Text>
              <Text style={styles.resetButtonText}>Reset All</Text>
            </View>
          </Pressable>
        </View>

        {optimized.length > 0 && (
          <View style={styles.resultsSection}>
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsSectionTitle}>
                Optimization Results
              </Text>
              <TouchableOpacity onPress={shareResults}>
                <MaterialIcons name="share" size={24} color="#3b82f6" />
              </TouchableOpacity>
            </View>

            <View ref={viewRef} collapsable={false}>
              <View style={styles.summarySection}>
                <Text style={styles.sectionTitle}>Required Sheets</Text>
                <View style={[styles.summaryRow, styles.summaryHeader]}>
                  <Text style={styles.summaryHeaderText}>Sheet Size</Text>
                  <Text style={styles.summaryHeaderText}>Quantity</Text>
                </View>

                {Object.entries(
                  optimized.reduce((acc: Record<string, number>, layout) => {
                    const key = `${layout.sheetSize.length}x${layout.sheetSize.width}`;
                    acc[key] = (acc[key] || 0) + layout.count;
                    return acc;
                  }, {} as Record<string, number>)
                ).map(([sheetSize, totalCount]) => (
                  <View key={sheetSize} style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{sheetSize} inch</Text>
                    <Text style={styles.summaryQty}>× {totalCount as number}</Text>
                  </View>
                ))}

                <View style={[styles.summaryRow, styles.summaryTotalRow]}>
                  <Text style={styles.summaryLabel}>Total Sheets Used</Text>
                  <Text style={styles.summaryValue}>
                    {optimized.reduce((sum, layout) => sum + layout.count, 0)}
                  </Text>
                </View>
              </View>

              <View style={styles.metricsGrid}>
                <MetricCard
                  label="Total pieces area (Qty)"
                  value={`${orderPieces.reduce(
                    (sum, piece) =>
                      sum + piece.length * piece.width * piece.quantity,
                    0
                  )} inch (${totalPiecesCut})`}
                />
                <MetricCard
                  label="Used sheets total area"
                  value={`${optimized.reduce(
                    (sum, layout) =>
                      sum +
                      layout.sheetSize.length *
                        layout.sheetSize.width *
                        layout.count,
                    0
                  )} inch`}
                />
                <MetricCard
                  label="Material Utilization"
                  value={`${(
                    (orderPieces.reduce(
                      (sum, piece) =>
                        sum + piece.length * piece.width * piece.quantity,
                      0
                    ) /
                      optimized.reduce(
                        (sum, layout) =>
                          sum +
                          layout.sheetSize.length *
                            layout.sheetSize.width *
                            layout.count,
                        0
                      )) *
                    100
                  ).toFixed(1)}%`}
                />
                <MetricCard
                  label="Total layouts"
                  value={optimized.length.toString()}
                />
              </View>

              {optimized.map((sheet, idx) => (
                <View
                  style={[
                    styles.sheetVisual,
                    {
                      aspectRatio:
                        sheet.sheetSize.width / sheet.sheetSize.length,
                    },
                  ]}
                >
                  {sheet.cuts.map((cut:any, i) => {
                    const widthPct = (cut.width / sheet.sheetSize.width) * 100;
                    const heightPct =
                      (cut.length / sheet.sheetSize.length) * 100;
                    const leftPct = (cut.x / sheet.sheetSize.width) * 100;
                    const topPct = (cut.y / sheet.sheetSize.length) * 100;

                    return (
                      <View
                        key={i}
                        style={[
                          styles.cutVisual,
                          {
                            position: "absolute",
                            width: `${widthPct}%`,
                            height: `${heightPct}%`,
                            left: `${leftPct}%`,
                            top: `${topPct}%`,
                            backgroundColor: `hsl(${i * 30}, 70%, 80%)`,
                          },
                        ]}
                      >
                        <Text style={styles.cutVisualText}>
                          {cut.length}×{cut.width}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  headerContainer: {
    paddingBottom: 15,
  },
  headerBackground: {
    backgroundColor: "#f8f9fa",
    paddingTop: 20,
  },

  titleContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 12,
  },
  logo: {
    height: 40,
    width: 200,
  },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  tabActive: {
    backgroundColor: "#f97316",
  },
  tabPressed: {
    opacity: 0.8,
  },
  tabContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  tabIcon: {
    marginRight: 8,
  },
  tabtext: {
    fontSize: 14,
    fontWeight: "500",
    color: "#f97316",
  },
  tabtextActive: {
    color: "#fff",
  },
  scrollView: {
    flex: 1,
  },
  section: {
    padding: 16,
  },
  inputCard: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  inputRow: {
    flexDirection: "row",
    marginBottom: 12,
  },
  inputGroup: {
    flex: 1,
    marginRight: 8,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#64748b",
    marginBottom: 4,
  },
  input: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
    padding: 8,
    fontSize: 14,
  },
  addButton: {
    backgroundColor: "#f97316",
    borderRadius: 4,
    padding: 12,
    alignItems: "center",
  },
  addButtonPressed: {
    backgroundColor: "#ea580c",
  },
  addButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonIcon: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    marginRight: 8,
  },
  addButtonText: {
    color: "#fff",
    fontWeight: "500",
  },
  tableContainer: {
    backgroundColor: "#fff",
    borderRadius: 8,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  emptyState: {
    padding: 24,
    alignItems: "center",
  },
  emptyStateIconContainer: {
    marginBottom: 12,
  },
  emptyStateIcon: {
    fontSize: 32,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#334155",
    marginBottom: 4,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: "#64748b",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  tableHeaderText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  tableCell: {
    flex: 1,
    justifyContent: "center",
  },
  tableCellText: {
    fontSize: 14,
    color: "#334155",
  },
  stockBadge: {
    backgroundColor: "#e0f2fe",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  stockBadgeText: {
    color: "#0369a1",
    fontSize: 12,
    fontWeight: "500",
  },
  quantityBadge: {
    backgroundColor: "#dcfce7",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  quantityBadgeText: {
    color: "#166534",
    fontSize: 12,
    fontWeight: "500",
  },
  deleteButtonPressed: {
    opacity: 0.6,
  },
  deleteButtonIcon: {
    fontSize: 16,
  },
  actionButtons: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  optimizeButton: {
    flex: 1,
    backgroundColor: "#ea580c",
    borderRadius: 6,
    padding: 12,
    marginRight: 8,
  },
  optimizeButtonPressed: {
  },
  buttonDisabled: {
    backgroundColor: "#9ca3af",
  },
  resetButton: {
    flex: 1,
    backgroundColor: "#e2e8f0",
    borderRadius: 6,
    padding: 12,
  },
  resetButtonPressed: {
    backgroundColor: "#cbd5e1",
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  optimizeButtonIcon: {
    color: "#fff",
    marginRight: 8,
  },
  optimizeButtonText: {
    color: "#fff",
    fontWeight: "500",
  },
  resetButtonIcon: {
    marginRight: 8,
  },
  resetButtonText: {
    fontWeight: "500",
    color: "#334155",
  },
  resultsSection: {
    padding: 16,
  },
  resultsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  resultsSectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1e293b",
  },
  successBadge: {
    flexDirection: "row",
    alignItems: "center",
  },
  summarySection: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1e293b",
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: "row",
    paddingVertical: 8,
  },
  summaryHeader: {
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    marginBottom: 4,
  },
  summaryHeaderText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
  },
  summaryLabel: {
    flex: 2,
    fontSize: 14,
    color: "#334155",
  },
  summaryValue: {
    flex: 1,
    fontSize: 14,
    color: "#334155",
    fontWeight: "500",
    textAlign: "right",
  },
  summaryQty: {
    flex: 1,
    fontSize: 14,
    color: "#334155",
    textAlign: "right",
  },
  summaryTotalRow: {
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    marginTop: 8,
    paddingTop: 12,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -8,
    marginBottom: 16,
  },
  metricCard: {
    width: "50%",
    padding: 8,
  },
  metricLabel: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: "500",
    color: "#1e293b",
  },
  layoutCard: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  layoutId: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1e293b",
    marginBottom: 4,
  },
  layoutInfo: {
    fontSize: 14,
    color: "#64748b",
    marginBottom: 12,
  },
  sheetVisual: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    marginVertical: 12,
    backgroundColor: "#f8fafc",
    position: "relative",
    minHeight: 100,
  },
  cutVisual: {
    position: "absolute",
    borderWidth: 1,
    borderColor: "#94a3b8",
    justifyContent: "center",
    alignItems: "center",
  },
  cutVisualText: {
    fontSize: 10,
    color: "#1e293b",
    fontWeight: "500",
  },
  cutList: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
  },
  cutListItem: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 16,
    marginBottom: 8,
  },
  cutListSize: {
    fontSize: 14,
    color: "#334155",
    marginRight: 4,
  },
  cutListQty: {
    fontSize: 12,
    color: "#64748b",
  },
  layoutFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  footerText: {
    fontSize: 12,
    color: "#64748b",
  },
});

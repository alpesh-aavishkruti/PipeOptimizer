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
    // Format stock sheets for API - using 'stock' instead of 'stock_sheets'
    const stock = availableSheets.flatMap((sheet) =>
      Array(sheet.stock)
        .fill(0)
        .map((_, i) => ({
          w: sheet.width,
          h: sheet.length,
          id: `sheet_${sheet.length}x${sheet.width}_${i}`,
        }))
    );
    console.log("stock:", stock);

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
      stock: stock, // Changed from 'stock_sheets' to 'stock'
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

  // Check if the API response has the expected structure
  if (!apiResponse.sheets || !Array.isArray(apiResponse.sheets)) {
    console.error("Invalid API response structure:", apiResponse);
    return optimizedSheets;
  }

  // Group identical sheet layouts
  const layoutGroups: { [key: string]: OptimizedSheet } = {};

  apiResponse.sheets.forEach((sheet: any) => {
    // Extract cuts information from pieces
    const cuts = sheet.pieces.map((piece: any) => ({
      length: piece.h,
      width: piece.w,
      x: piece.x, // Include x position
      y: piece.y, // Include y position
    }));

    // Create signature for grouping identical layouts
    const cutsSignature = cuts
      .map((c) => `${c.length}x${c.width}`)
      .sort()
      .join("|");

    const signature = `${sheet.size.w}x${sheet.size.h}|${cutsSignature}`;

    if (!layoutGroups[signature]) {
      // Calculate efficiency (used area / total area)
      const usedArea = cuts.reduce(
        (sum, cut) => sum + cut.length * cut.width,
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
          length: 0, // You might want to calculate this based on the layout
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
                  optimized.reduce((acc: any, layout) => {
                    const key = `${layout.sheetSize.length}x${layout.sheetSize.width}`;
                    acc[key] = (acc[key] || 0) + layout.count;
                    return acc;
                  }, {})
                ).map(([sheetSize, totalCount]) => (
                  <View key={sheetSize} style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{sheetSize} inch</Text>
                    <Text style={styles.summaryQty}>× {totalCount}</Text>
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
                  {sheet.cuts.map((cut, i) => {
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
// const styles = StyleSheet.create({
//   headerContainer: {
//     paddingBottom: 15,
//   },
//   headerBackground: {
//     backgroundColor: "#f8f9fa",
//     paddingTop: 60,
//     paddingBottom: 30,
//     borderBottomLeftRadius: 25,
//     borderBottomRightRadius: 25,
//     overflow: "hidden",
//     position: "relative",
//     alignItems: "center",
//     justifyContent: "center",
//   },
//   logo: {
//     width: 300,
//     height: 40,
//   },
//   sharelogo: {
//     width: 50,
//     height: 40,
//     backgroundColor: "#f8f9fa",
//   },

//   titleContainer: {
//     alignItems: "center",
//     position: "relative",
//     zIndex: 2,
//   },
//   titleMain: {},

//   tabContainer: {
//     flexDirection: "row",
//     backgroundColor: "#fff",
//     marginHorizontal: 20,
//     marginTop: -20,
//     borderRadius: 15,
//     elevation: 8,
//     shadowColor: "#f97316",
//     shadowOffset: { width: 0, height: 4 },
//     shadowOpacity: 0.15,
//     shadowRadius: 10,
//     overflow: "hidden",
//   },
//   tab: {
//     flex: 1,
//     paddingVertical: 16,
//     alignItems: "center",
//     backgroundColor: "transparent",
//     position: "relative",
//   },
//   tabActive: {
//     backgroundColor: "#f97316",
//   },
//   tabPressed: {
//     opacity: 0.8,
//     transform: [{ scale: 0.98 }],
//   },
//   tabContent: {
//     alignItems: "center",
//     flexDirection: "row",
//     gap: 8,
//   },
//   tabIcon: {
//     marginBottom: 2,
//   },
//   tabtext: {
//     color: "#f97316",
//     fontSize: 14,
//     fontWeight: "600",
//     letterSpacing: 0.3,
//   },
//   tabtextActive: {
//     color: "#fff",
//     fontWeight: "700",
//   },
//   activeIndicator: {
//     position: "absolute",
//     bottom: 0,
//     width: "40%",
//     height: 3,
//     backgroundColor: "#fff",
//     borderRadius: 2,
//   },
//   section: {
//     marginTop: 20,
//     paddingHorizontal: 16,
//   },
//   inputCard: {
//     backgroundColor: "#fff",
//     borderRadius: 12,
//     padding: 16,
//     marginBottom: 20,
//     shadowColor: "#000",
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.05,
//     shadowRadius: 8,
//     elevation: 2,
//   },
//   inputRow: {
//     flexDirection: "row",
//     gap: 12,
//     marginBottom: 16,
//   },
//   inputGroup: {
//     flex: 1,
//   },
//   inputLabel: {
//     fontSize: 14,
//     fontWeight: "600",
//     color: "#4b5563",
//     marginBottom: 6,
//   },
//   inputWrapper: {
//     flexDirection: "row",
//     alignItems: "center",
//     // borderWidth: 1,
//     // borderColor: "#e5e7eb",
//     // borderRadius: 8,
//     overflow: "hidden",
//   },
//   input: {
//     flex: 1,
//     paddingVertical: 10,
//     paddingHorizontal: 12,
//     fontSize: 16,
//     borderWidth: 1,
//     borderColor: "#e5e7eb",
//     borderRadius: 8,
//     color: "#1f2937",
//     backgroundColor: "#f9fafb",
//   },
//   inputUnit: {
//     paddingHorizontal: 12,
//     fontSize: 14,
//     color: "#6b7280",
//     backgroundColor: "#f3f4f6",
//   },
//   addButton: {
//     backgroundColor: "#f97316",
//     borderRadius: 8,
//     paddingVertical: 12,
//   },
//   addButtonPressed: {
//     opacity: 0.9,
//     transform: [{ scale: 0.98 }],
//   },
//   addButtonContent: {
//     flexDirection: "row",
//     justifyContent: "center",
//     alignItems: "center",
//     gap: 8,
//   },
//   addButtonIcon: {
//     color: "#fff",
//     fontSize: 18,
//     fontWeight: "bold",
//   },
//   addButtonText: {
//     color: "#fff",
//     fontSize: 16,
//     fontWeight: "600",
//   },
//   tableContainer: {
//     backgroundColor: "#fff",
//     borderRadius: 12,
//     overflow: "hidden",
//     shadowColor: "#000",
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.05,
//     shadowRadius: 8,
//     elevation: 2,
//   },
//   tableHeader: {
//     flexDirection: "row",
//     backgroundColor: "#f9fafb",
//     paddingVertical: 12,
//     borderBottomWidth: 1,
//     borderBottomColor: "#e5e7eb",
//   },
//   tableHeaderText: {
//     flex: 1,
//     textAlign: "center",
//     fontWeight: "600",
//     color: "#4b5563",
//     fontSize: 14,
//   },
//   tableRow: {
//     flexDirection: "row",
//     paddingVertical: 14,
//     borderBottomWidth: 1,
//     borderBottomColor: "#f3f4f6",
//   },
//   tableCell: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   tableCellText: {
//     fontSize: 15,
//     color: "#1f2937",
//     fontWeight: "500",
//   },
//   stockBadge: {
//     backgroundColor: "#d1fae5",
//     paddingHorizontal: 10,
//     paddingVertical: 4,
//     borderRadius: 12,
//     minWidth: 40,
//   },
//   lowStockBadge: {
//     backgroundColor: "#fee2e2",
//   },
//   stockBadgeText: {
//     color: "#065f46",
//     fontWeight: "600",
//     textAlign: "center",
//   },
//   deleteButton: {
//     backgroundColor: "#fee2e2",
//     width: 32,
//     height: 32,
//     borderRadius: 16,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   deleteButtonPressed: {
//     transform: [{ scale: 0.9 }],
//   },
//   deleteButtonIcon: {
//     color: "#dc2626",
//     fontSize: 16,
//     fontWeight: "bold",
//   },
//   emptyState: {
//     paddingVertical: 40,
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   emptyStateIconContainer: {
//     backgroundColor: "#f3f4f6",
//     width: 60,
//     height: 60,
//     borderRadius: 30,
//     justifyContent: "center",
//     alignItems: "center",
//     marginBottom: 12,
//   },
//   emptyStateIcon: {
//     fontSize: 28,
//   },
//   emptyStateText: {
//     fontSize: 16,
//     fontWeight: "600",
//     color: "#1f2937",
//     marginBottom: 4,
//   },
//   emptyStateSubtext: {
//     fontSize: 14,
//     color: "#6b7280",
//     textAlign: "center",
//     paddingHorizontal: 40,
//   },

//   actionButtons: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginTop: 24,
//     marginBottom: 10,
//     marginHorizontal: 16,
//     gap: 16,
//   },
//   buttonContent: {
//     flexDirection: "row",
//     alignItems: "center",
//     justifyContent: "center",
//     gap: 8,
//   },
//   optimizeButton: {
//     flex: 1,
//     backgroundColor: "#f97316",
//     paddingVertical: 16,
//     borderRadius: 12,
//     alignItems: "center",
//     justifyContent: "center",
//     elevation: 3,
//     shadowColor: "#f97316",
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.3,
//     shadowRadius: 4,
//   },
//   optimizeButtonPressed: {
//     opacity: 0.9,
//     transform: [{ scale: 0.98 }],
//   },
//   buttonDisabled: {
//     backgroundColor: "#9ca3af",
//     shadowColor: "#6b7280",
//     opacity: 0.7,
//   },
//   optimizeButtonText: {
//     color: "#fff",
//     fontSize: 16,
//     fontWeight: "600",
//   },
//   optimizeButtonIcon: {
//     fontSize: 18,
//   },
//   resetButton: {
//     flex: 1,
//     backgroundColor: "#fff",
//     paddingVertical: 16,
//     borderRadius: 12,
//     borderWidth: 1,
//     borderColor: "#e5e7eb",
//     alignItems: "center",
//     paddingBottom: 16,
//     justifyContent: "center",
//   },
//   resetButtonPressed: {
//     backgroundColor: "#f3f4f6",
//     transform: [{ scale: 0.98 }],
//   },
//   resetButtonText: {
//     color: "#4b5563",
//     fontSize: 16,
//     fontWeight: "600",
//   },
//   resetButtonIcon: {
//     fontSize: 18,
//     color: "#4b5563",
//   },
//   resultsSection: {
//     marginTop: 24,
//     paddingHorizontal: 16,
//   },
//   resultsHeader: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     alignItems: "center",
//     marginBottom: 16,
//   },
//   resultsSectionTitle: {
//     fontSize: 20,
//     fontWeight: "700",
//     color: "#1f2937",
//   },

//   successBadge: {
//     paddingVertical: 10,
//     paddingHorizontal: 24,
//     flexDirection: "row",
//     alignItems: "center",
//     alignSelf: "center", // Centered button
//   },
//   successBadgeText: {
//     // color: "#fff",
//     fontWeight: "bold",
//     fontSize: 16,
//   },
//   shareIcon: {
//     marginRight: 8,
//     fontSize: 16,
//     color: "#fff",
//   },

//   statsContainer: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginBottom: 20,
//   },
//   statCard: {
//     backgroundColor: "#fff",
//     borderRadius: 12,
//     padding: 16,
//     flex: 1,
//     marginHorizontal: 4,
//     alignItems: "center",
//     elevation: 2,
//     shadowColor: "#000",
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.1,
//     shadowRadius: 4,
//   },
//   statNumber: {
//     fontSize: 20,
//     fontWeight: "700",
//     color: "#f97316",
//     marginBottom: 4,
//   },
//   statLabel: {
//     fontSize: 14,
//     color: "#6b7280",
//   },
//   resultsTable: {
//     backgroundColor: "#fff",
//     borderRadius: 12,
//     overflow: "hidden",
//     elevation: 2,
//     marginHorizontal: 4,
//     marginBottom: 24,
//     shadowColor: "#000",
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.1,
//     shadowRadius: 4,
//   },
//   tableHeaderRow: {
//     flexDirection: "row",
//     backgroundColor: "#f9fafb",
//     paddingVertical: 14,
//     paddingHorizontal: 12,
//     borderBottomWidth: 1,
//     borderBottomColor: "#e5e7eb",
//   },
//   headerText: {
//     fontWeight: "600",
//     color: "#4b5563",
//     fontSize: 14,
//     textAlign: "center",
//     flex: 1,
//   },

//   evenRow: {
//     backgroundColor: "#f9fafb",
//   },
//   quantityBadge: {
//     backgroundColor: "#dbeafe",
//     paddingHorizontal: 10,
//     paddingVertical: 4,
//     borderRadius: 12,
//     minWidth: 32,
//   },
//   pipeSizeText: {
//     fontWeight: "600",
//     color: "#1f2937",
//   },
//   cutsContainer: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//     justifyContent: "center",
//     gap: 6,
//   },
//   cutPill: {
//     backgroundColor: "#e5e7eb",
//     paddingHorizontal: 8,
//     paddingVertical: 4,
//     borderRadius: 12,
//   },
//   cutText: {
//     fontSize: 12,
//     fontWeight: "500",
//     color: "#1f2937",
//   },

//   quantityText: {
//     color: "#1e40af",
//     fontWeight: "600",
//     textAlign: "center",
//   },
//   quantityBadgeText: {
//     color: "#1e40af",
//     fontWeight: "600",
//     textAlign: "center",
//   },
//   wasteText: {
//     fontWeight: "500",
//     color: "#dc2626",
//   },
//   totalRow: {
//     flexDirection: "row",
//     backgroundColor: "#f3f4f6",
//     paddingVertical: 14,
//     paddingHorizontal: 12,
//   },
//   totalText: {
//     fontWeight: "700",
//     color: "#1f2937",
//     textAlign: "center",
//     flex: 1,
//   },
//   safe: {
//     flex: 1,
//     backgroundColor: "#f8fafc",
//   },

//   subtitle: {
//     fontSize: 16,
//     color: "#bfdbfe",
//     textAlign: "center",
//     fontWeight: "500",
//   },

//   header: {
//     paddingTop: 50,
//     paddingBottom: 25,
//     paddingHorizontal: 20,
//     borderBottomLeftRadius: 25,
//     borderBottomRightRadius: 25,
//     shadowColor: "#000",
//     shadowOffset: { width: 0, height: 4 },
//     shadowOpacity: 0.1,
//     shadowRadius: 10,
//   },
//   title: {
//     fontSize: 28,
//     fontWeight: "800",
//     color: "#fff",
//     textAlign: "center",
//     textShadowColor: "rgba(0,0,0,0.1)",
//     textShadowOffset: { width: 0, height: 2 },
//     textShadowRadius: 4,
//     letterSpacing: 0.5,
//   },

//   scrollView: {
//     flex: 1,
//     marginTop: 20,
//   },

//   sectionSubtitle: {
//     fontSize: 16,
//     color: "#64748b",
//     marginBottom: 20,
//   },

//   // Summary Table Styles
//   summaryTable: {
//     borderRadius: 16,
//     overflow: "hidden",
//     shadowRadius: 8,
//   },

//   summaryCell: {
//     flex: 1,
//     alignItems: "center",
//   },
//   summaryCellText: {
//     fontSize: 14,
//     fontWeight: "600",
//     textAlign: "center",
//   },
//   wasteCellText: {
//     fontSize: 14,
//     fontWeight: "600",
//     color: "#ef4444",
//     textAlign: "center",
//   },

//   totalCellText: {
//     fontSize: 16,
//     fontWeight: "800",
//     color: "#1e293b",
//     textAlign: "center",
//   },
//   totalWasteCellText: {
//     fontSize: 16,
//     fontWeight: "800",
//     color: "#ef4444",
//     textAlign: "center",
//   },

//   metricsGrid: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//     justifyContent: "space-between",
//     marginBottom: 16,
//   },
//   metricCard: {
//     width: "48%",
//     // backgroundColor: "#fef3c7", // Soft warm background
//     padding: 12,
//     borderRadius: 10,
//     marginBottom: 10,
//     borderColor: "#fcd34d",
//     borderWidth: 1,
//   },
//   metricValue: {
//     fontSize: 16,
//     fontWeight: "700",
//     color: "#f97316",
//   },
//   metricLabel: {
//     fontSize: 12,
//     color: "#6b7280",
//   },

//   layoutCard: {
//     padding: 12,
//     borderWidth: 1,
//     borderColor: "#e5e7eb",
//     borderRadius: 10,
//     marginBottom: 16,
//     // backgroundColor: "#fff", // Clean white background
//   },
//   layoutId: {
//     fontWeight: "bold",
//     marginBottom: 4,
//     color: "#111827",
//   },
//   layoutInfo: {
//     fontSize: 14,
//     color: "#f97316",
//     marginBottom: 8,
//   },

//   cutRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     paddingVertical: 2,
//   },
//   cutLabel: {
//     fontSize: 14,
//     color: "#374151",
//   },
//   cutQty: {
//     fontWeight: "600",
//     color: "#f97316", // Orange emphasis
//   },

//   cutBar: {
//     flexDirection: "row",
//     marginVertical: 8,
//     flexWrap: "wrap",
//   },
//   cutBlock: {
//     backgroundColor: "#f97316", // Highlight color
//     paddingVertical: 4,
//     paddingHorizontal: 6,
//     borderRadius: 4,
//     margin: 2,
//   },
//   cutBlockText: {
//     fontSize: 12,
//     color: "#fff",
//   },

//   layoutFooter: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     marginTop: 8,
//   },
//   footerText: {
//     fontSize: 12,
//     color: "#6b7280",
//   },

//   summarySection: {
//     marginBottom: 16,
//     padding: 10,
//     backgroundColor: "#fff",
//     borderRadius: 8,
//     borderWidth: 1,
//     borderColor: "#e5e7eb",
//   },

//   sectionTitle: {
//     fontSize: 16,
//     fontWeight: "700",
//     color: "#111827",
//     marginBottom: 8,
//   },

//   summaryHeader: {
//     flexDirection: "row",
//     paddingVertical: 6,
//     backgroundColor: "#f9fafb",
//     borderBottomWidth: 1,
//   },

//   summaryHeaderText: {
//     width: "33.33%",
//     fontSize: 14,
//     fontWeight: "600",
//     color: "#6b7280",
//     textAlign: "center",
//   },

//   summaryRow: {
//     flexDirection: "row",
//     alignItems: "center",
//     paddingVertical: 6,
//     borderColor: "#f3f4f6",
//   },

//   summaryLabel: {
//     width: "33.33%",
//     fontSize: 14,
//     color: "#374151",
//     textAlign: "left",
//     paddingLeft: 4,
//   },

//   summaryValue: {
//     width: "33.33%",
//     fontSize: 14,
//     color: "#111827",
//     textAlign: "center",
//   },

//   summaryQty: {
//     width: "33.33%",
//     fontSize: 14,
//     fontWeight: "600",
//     color: "#f97316",
//     textAlign: "right",
//     paddingRight: 4,
//   },

//   summaryTotalRow: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     borderTopWidth: 1,
//     borderColor: "#e5e7eb",
//     marginTop: 6,
//     paddingTop: 8,
//   },
// });

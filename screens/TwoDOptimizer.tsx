import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useRef, useState } from "react";

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
// Define types
type Pipe = {
  size: number;
  stock: number;
};

type OrderPiece = {
  length: number;
  quantity: number;
};

type OptimizedPipe = {
  pipeSize: number;
  remaining: number;
  cuts: number[];
  count: number;
  efficiency: number;
};

type Demand = {
  length: number;
  quantity: number;
};

const solveCuttingStock = (
  availablePipes: Pipe[],
  demandList: Demand[]
): OptimizedPipe[] => {
  const remainingDemand = demandList.reduce((acc, d) => {
    acc[d.length] = d.quantity;
    return acc;
  }, {} as Record<number, number>);

  const solution: OptimizedPipe[] = [];

  const generateCuttingPatterns = (
    pipeSize: number,
    demands: Record<number, number>
  ) => {
    const lengths = Object.keys(demands)
      .map(Number)
      .sort((a, b) => b - a);
    const patterns: Array<{
      cuts: number[];
      waste: number;
      efficiency: number;
    }> = [];

    const generatePattern = (
      remaining: number,
      currentCuts: number[],
      lengthIndex: number
    ) => {
      if (lengthIndex >= lengths.length) {
        if (currentCuts.length > 0) {
          const usedLength = currentCuts.reduce((sum, cut) => sum + cut, 0);
          const waste = remaining;
          const efficiency = (usedLength / pipeSize) * 100;

          if (efficiency >= 70) {
            patterns.push({
              cuts: [...currentCuts],
              waste,
              efficiency,
            });
          }
        }
        return;
      }

      const currentLength = lengths[lengthIndex];
      const maxPieces = Math.min(
        Math.floor(remaining / currentLength),
        demands[currentLength] || 0
      );

      for (let qty = 0; qty <= maxPieces; qty++) {
        const newCuts = [...currentCuts, ...Array(qty).fill(currentLength)];
        const newRemaining = remaining - qty * currentLength;
        generatePattern(newRemaining, newCuts, lengthIndex + 1);
      }
    };

    generatePattern(pipeSize, [], 0);

    return patterns.sort((a, b) => {
      if (Math.abs(a.efficiency - b.efficiency) < 0.1) {
        return a.waste - b.waste;
      }
      return b.efficiency - a.efficiency;
    });
  };

  // Main optimization loop
  while (Object.values(remainingDemand).some((qty) => qty > 0)) {
    let bestPattern = null;
    let bestPipeSize = 0;
    let bestScore = -1;

    for (const pipe of availablePipes) {
      if (pipe.stock <= 0) continue;

      const patterns = generateCuttingPatterns(pipe.size, remainingDemand);

      for (const pattern of patterns) {
        const canUse = pattern.cuts.every((length) => {
          const needed = pattern.cuts.filter((cut) => cut === length).length;
          return (remainingDemand[length] || 0) >= needed;
        });

        if (canUse) {
          const demandSatisfied = pattern.cuts.reduce((score, length) => {
            return score + (remainingDemand[length] || 0);
          }, 0);

          const score = pattern.efficiency + demandSatisfied * 10;

          if (score > bestScore) {
            bestScore = score;
            bestPattern = pattern;
            bestPipeSize = pipe.size;
          }
          break;
        }
      }
    }

    if (!bestPattern) {
      const sortedLengths = Object.keys(remainingDemand)
        .map(Number)
        .filter((length) => remainingDemand[length] > 0)
        .sort((a, b) => b - a);

      if (sortedLengths.length === 0) break;

      const largestPiece = sortedLengths[0];
      const suitablePipe = availablePipes
        .filter((pipe) => pipe.size >= largestPiece && pipe.stock > 0)
        .sort((a, b) => a.size - b.size)[0];

      if (suitablePipe) {
        const cuts: number[] = [];
        let remaining = suitablePipe.size;

        for (const length of sortedLengths) {
          while (remaining >= length && remainingDemand[length] > 0) {
            cuts.push(length);
            remaining -= length;
            remainingDemand[length]--;
          }
        }

        const usedLength = cuts.reduce((sum, cut) => sum + cut, 0);
        bestPattern = {
          cuts,
          waste: remaining,
          efficiency: (usedLength / suitablePipe.size) * 100,
        };
        bestPipeSize = suitablePipe.size;
      } else {
        break;
      }
    }

    if (bestPattern) {
      bestPattern.cuts.forEach((length) => {
        remainingDemand[length] = Math.max(0, remainingDemand[length] - 1);
      });

      const pipeIndex = availablePipes.findIndex(
        (p) => p.size === bestPipeSize
      );
      if (pipeIndex >= 0) {
        availablePipes[pipeIndex].stock--;
      }

      const existingIndex = solution.findIndex(
        (s) =>
          s.pipeSize === bestPipeSize &&
          JSON.stringify(s.cuts.sort()) ===
            JSON.stringify(bestPattern.cuts.sort())
      );

      if (existingIndex >= 0) {
        solution[existingIndex].count++;
      } else {
        solution.push({
          pipeSize: bestPipeSize,
          remaining: bestPattern.waste,
          cuts: bestPattern.cuts,
          count: 1,
          efficiency: bestPattern.efficiency,
        });
      }
    }
  }

  return solution;
};

export default function TwoDOptimizer({ navigation }: any) {
  const [orderPieces, setOrderPieces] = useState<OrderPiece[]>([]);
  const [lengthInput, setLengthInput] = useState<string>("");
  const [pipeSizeInput, setPipeSizeInput] = useState<string>("");
  const [stockInput, setStockInput] = useState<string>("");
  const [quantityInput, setQuantityInput] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"pipes" | "calculator">("pipes");
  const [availablePipes, setAvailablePipes] = useState<Pipe[]>([]);
  const [optimized, setOptimized] = useState<OptimizedPipe[]>([]);
  const [totalPiecesNeeded, setTotalPiecesNeeded] = useState(0);
  const [totalPiecesCut, setTotalPiecesCut] = useState(0);
  const [uncutCount, setUncutCount] = useState(0); // Add this in your component state

  const flattenPieces = (): number[] => {
    const pieces: number[] = [];
    orderPieces.forEach(({ length, quantity }) => {
      for (let i = 0; i < quantity; i++) {
        pieces.push(length);
      }
    });
    return pieces;
  };

  useEffect(() => {
    const loadPipes = async () => {
      try {
        const stored = await AsyncStorage.getItem("availablePipes");
        if (stored) {
          setAvailablePipes(JSON.parse(stored));
        }
      } catch (e) {
        console.error("Failed to load pipes", e);
      }
    };

    loadPipes();
  }, []);

  useEffect(() => {
    const savePipes = async () => {
      try {
        await AsyncStorage.setItem(
          "availablePipes",
          JSON.stringify(availablePipes)
        );
      } catch (e) {
        console.error("Failed to save pipes", e);
      }
    };

    savePipes();
  }, [availablePipes]);

  const optimizePipes = () => {
    const pieces = flattenPieces();
    if (pieces.length === 0) return;

    const demandList: Demand[] = [];
    const pieceCounts = pieces.reduce((acc, p) => {
      acc[p] = (acc[p] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    Object.entries(pieceCounts).forEach(([length, quantity]) => {
      demandList.push({ length: Number(length), quantity });
    });

    const pipesCopy = availablePipes.map((pipe) => ({ ...pipe }));
    const optimizedResult = solveCuttingStock(pipesCopy, demandList);
    setOptimized(optimizedResult);

    // Calculate totals
    const totalNeeded = pieces.length;
    const totalCut = optimizedResult.reduce((sum, opt) => {
      return sum + opt.cuts.length * opt.count;
    }, 0);

    setTotalPiecesNeeded(totalNeeded);
    setTotalPiecesCut(totalCut);
    setUncutCount(totalNeeded - totalCut);
  };

  const resetAll = (): void => {
    setOrderPieces([]);
    setLengthInput("");
    setQuantityInput("");
    setPipeSizeInput("");
    setStockInput("");
    setOptimized([]);
    setAvailablePipes([]);
    setTotalPiecesNeeded(0);
    setTotalPiecesCut(0);
  };

  const removePipe = (sizeToRemove: number): void => {
    setAvailablePipes((prev) => prev.filter((p) => p.size !== sizeToRemove));
  };

  const removeOrderPiece = (indexToRemove: number): void => {
    setOrderPieces(orderPieces.filter((_, index) => index !== indexToRemove));
  };
  const viewRef = useRef();

  const getCutCounts = (cuts) => {
    return cuts.reduce((acc, cut) => {
      acc[cut] = (acc[cut] || 0) + 1;
      return acc;
    }, {});
  };
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#1a365d" />

      {/* Header */}
      <View style={styles.headerContainer}>
        <View style={styles.headerBackground}>
          {/* Decorative elements */}

          {/* Main title with custom styling */}
          <View style={styles.titleContainer}>
            <View>
              {/* Logo from assets */}
              <Image
                source={require("../assets/aavishkruti-logo.png")}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
          </View>
        </View>
      </View>

      {/* Enhanced Tab Container */}
      <View style={styles.tabContainer}>
        <Pressable
          style={({ pressed }) => [
            styles.tab,
            activeTab === "pipes" && styles.tabActive,
            pressed && styles.tabPressed,
          ]}
          onPress={() => setActiveTab("pipes")}
        >
          <View style={styles.tabContent}>
            {/* Custom Pipe SVG Icon */}
            <Svg
              width={20}
              height={20}
              viewBox="0 0 24 24"
              style={styles.tabIcon}
            >
              <Path
                d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
                fill={activeTab === "pipes" ? "#fff" : "#f97316"}
              />
              <Path
                d="M8 8h8v8H8z"
                fill={activeTab === "pipes" ? "#fff" : "#f97316"}
              />
            </Svg>
            <Text
              style={[
                styles.tabtext,
                activeTab === "pipes" && styles.tabtextActive,
              ]}
            >
              Pipe Sizes
            </Text>
          </View>
          {activeTab === "pipes"}
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
            {/* Custom Calculator SVG Icon */}
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
          {activeTab === "calculator"}
        </Pressable>
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === "pipes" && (
          <View style={styles.section}>
            {/* Enhanced Input Card */}
            <View style={styles.inputCard}>
              <View style={styles.inputRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Pipe Size (inch)</Text>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g., 100"
                      placeholderTextColor="#9ca3af"
                      value={pipeSizeInput}
                      keyboardType="numeric"
                      onChangeText={setPipeSizeInput}
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Stock Quantity</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g., 10"
                    placeholderTextColor="#9ca3af"
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
                  const size = parseInt(pipeSizeInput.trim());
                  const stock = parseInt(stockInput.trim());

                  if (!isNaN(size) && !isNaN(stock) && size > 0 && stock > 0) {
                    setAvailablePipes((prev) => {
                      const existingIndex = prev.findIndex(
                        (p) => p.size === size
                      );
                      if (existingIndex !== -1) {
                        // Pipe size already exists – update stock
                        const updated = [...prev];
                        updated[existingIndex].stock += stock;
                        return updated;
                      } else {
                        // Add new pipe
                        return [...prev, { size, stock }];
                      }
                    });

                    setPipeSizeInput("");
                    setStockInput("");
                  }
                }}
              >
                <View style={styles.addButtonContent}>
                  <Text style={styles.addButtonIcon}>+</Text>
                  <Text style={styles.addButtonText}>Add to Inventory</Text>
                </View>
              </Pressable>
            </View>

            {/* Modern Table Design */}
            <View style={styles.tableContainer}>
              {availablePipes.length === 0 ? (
                <View style={styles.emptyState}>
                  <View style={styles.emptyStateIconContainer}>
                    <Text style={styles.emptyStateIcon}>📦</Text>
                  </View>
                  <Text style={styles.emptyStateText}>
                    No pipes in inventory
                  </Text>
                  <Text style={styles.emptyStateSubtext}>
                    Add pipes using the form above
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.tableHeader}>
                    <Text style={styles.tableHeaderText}>Pipe Size</Text>
                    <Text style={styles.tableHeaderText}>Stock</Text>
                    <Text style={styles.tableHeaderText}>Action</Text>
                  </View>

                  {availablePipes.map((pipe, index) => (
                    <View key={index} style={styles.tableRow}>
                      <View style={styles.tableCell}>
                        <Text style={styles.tableCellText}>{pipe.size} "</Text>
                      </View>

                      <View style={styles.tableCell}>
                        <View style={[styles.stockBadge]}>
                          <Text style={styles.stockBadgeText}>
                            {pipe.stock}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.tableCell}>
                        <Pressable
                          style={({ pressed }) => [
                            // styles.deleteButton,
                            pressed && styles.deleteButtonPressed,
                          ]}
                          onPress={() => removePipe(pipe.size)}
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
            {/* Enhanced Input Card */}
            <View style={styles.inputCard}>
              <View style={styles.inputRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Cut Length (inch)</Text>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g., 2500"
                      placeholderTextColor="#9ca3af"
                      value={lengthInput}
                      keyboardType="numeric"
                      onChangeText={setLengthInput}
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Quantity</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g., 5"
                    placeholderTextColor="#9ca3af"
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
                  const quantity = parseInt(quantityInput);
                  if (
                    !isNaN(length) &&
                    !isNaN(quantity) &&
                    length > 0 &&
                    quantity > 0
                  ) {
                    setOrderPieces([...orderPieces, { length, quantity }]);
                    setLengthInput("");
                    setQuantityInput("");
                  }
                }}
              >
                <View style={styles.addButtonContent}>
                  <Text style={styles.addButtonIcon}>+</Text>
                  <Text style={styles.addButtonText}>Add Cut Requirement</Text>
                </View>
              </Pressable>
            </View>

            {/* Modern Table Design */}
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
                    Add cut lengths and quantities above
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.tableHeader}>
                    <Text style={styles.tableHeaderText}>Length</Text>
                    <Text style={styles.tableHeaderText}>Qty</Text>
                    <Text style={styles.tableHeaderText}></Text>
                  </View>

                  {orderPieces.map((item, index) => (
                    <View key={index} style={styles.tableRow}>
                      <View style={styles.tableCell}>
                        <Text style={styles.tableCellText}>
                          {item.length} "
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
                            // styles.deleteButton,
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

        {/* Enhanced Action Buttons */}
        <View style={styles.actionButtons}>
          {activeTab === "calculator" && (
            <Pressable
              style={({ pressed }) => [
                styles.optimizeButton,
                orderPieces.length === 0 && styles.buttonDisabled,
                pressed && styles.optimizeButtonPressed,
              ]}
              onPress={optimizePipes}
              disabled={orderPieces.length === 0}
              android_ripple={{
                color: "rgba(255,255,255,0.3)",
                borderless: false,
              }}
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
            android_ripple={{ color: "rgba(0,0,0,0.1)", borderless: false }}
          >
            <View style={styles.buttonContent}>
              <Text style={styles.resetButtonIcon}>🔄</Text>
              <Text style={styles.resetButtonText}>Reset All</Text>
            </View>
          </Pressable>
        </View>

        {/* Enhanced Results Section */}
        {optimized.length > 0 && (
          <View style={styles.resultsSection}>
            {/* Results Header with Celebration Icon */}
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsSectionTitle}>
                Optimization Results
              </Text>
              <TouchableOpacity
                style={styles.successBadge}
                onPress={async () => {
                  try {
                    const uri = await captureRef(viewRef, {
                      format: "png",
                      quality: 1,
                    });
                    await Sharing.shareAsync(uri);
                  } catch (error) {
                    console.error("Error capturing screenshot:", error);
                  }
                }}
              >
                <View>
                  {/* Logo from assets */}
                  <MaterialIcons name="share" size={24} />
                </View>
              </TouchableOpacity>
            </View>
            <View
              ref={viewRef}
              collapsable={false}
              style={{
                backgroundColor: "#f8fafc", // Your app's background color
                padding: 10,
              }}
            >
              {/* Stats Cards Row */}
              <View style={styles.summarySection}>
                <Text style={styles.sectionTitle}>Required Stocks</Text>

                {/* Table Header */}
                <View style={[styles.summaryRow, styles.summaryHeader]}>
                  <Text style={styles.summaryHeaderText}>Stock Length</Text>
                  <Text style={styles.summaryHeaderText}>Size</Text>
                  <Text style={styles.summaryHeaderText}>Qty</Text>
                </View>

                {/* Table Rows */}
                {Object.entries(
                  optimized.reduce((acc: any, layout) => {
                    const key = layout.pipeSize;
                    acc[key] = (acc[key] || 0) + layout.count;
                    return acc;
                  }, {})
                ).map(([pipeSize, totalCount]) => (
                  <View key={pipeSize} style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Stock length</Text>
                    <Text style={styles.summaryValue}>{pipeSize}"</Text>
                    <Text style={styles.summaryQty}>× {totalCount}</Text>
                  </View>
                ))}

                {/* Total Row */}
                <View style={[styles.summaryRow, styles.summaryTotalRow]}>
                  <Text style={styles.summaryLabel}>Total Pipes Used</Text>
                  <Text style={styles.summaryValue}></Text>
                  {/* Empty, to keep 3-column structure */}
                  <Text style={styles.summaryQty}>
                    {optimized.reduce((sum, layout) => sum + layout.count, 0)}
                  </Text>
                </View>
              </View>

              {/* Metrics Section */}
              <View style={styles.metricsGrid}>
                <MetricCard
                  label="Total parts length (Qty)"
                  value={`${orderPieces.reduce(
                    (sum, piece) => sum + piece.length * piece.quantity,
                    0
                  )} (${totalPiecesCut})`}
                />
                <MetricCard
                  label="Used stocks total length (Yield)"
                  value={`${optimized.reduce(
                    (sum, layout) => sum + layout.pipeSize * layout.count,
                    0
                  )} (${(
                    (orderPieces.reduce(
                      (sum, piece) => sum + piece.length * piece.quantity,
                      0
                    ) /
                      optimized.reduce(
                        (sum, layout) => sum + layout.pipeSize * layout.count,
                        0
                      )) *
                    100
                  ).toFixed(1)}%)`}
                />
                <MetricCard
                  label="Total cutting layouts"
                  value={optimized.length.toString()}
                />
                <MetricCard
                  label="Total number of cuts"
                  value={optimized
                    .reduce(
                      (sum, layout) => sum + layout.cuts.length * layout.count,
                      0
                    )
                    .toString()}
                />
              </View>

              {/* Cutting Layouts */}
              {optimized.map((layout, idx) => (
                <View key={idx} style={styles.layoutCard}>
                  <Text style={styles.layoutId}>Layout ID {idx + 1}</Text>
                  <Text style={styles.layoutInfo}>
                    Repetition: {layout.count}x | Stock length:{" "}
                    {layout.pipeSize}"
                  </Text>

                  {/* Part List */}
                  {Object.entries(getCutCounts(layout.cuts)).map(
                    ([cut, count], i) => (
                      <View key={i} style={styles.cutRow}>
                        <Text style={styles.cutLabel}>{cut}"</Text>
                        <Text style={styles.cutQty}>× {count}</Text>
                      </View>
                    )
                  )}

                  {/* Visual Cut Bar */}
                  <View style={styles.cutBar}>
                    {layout.cuts.map((cut, i) => (
                      <View key={i} style={styles.cutBlock}>
                        <Text style={styles.cutBlockText}>{cut}"</Text>
                      </View>
                    ))}
                  </View>

                  <View style={styles.layoutFooter}>
                    <Text style={styles.footerText}>
                      Cuts: {layout.cuts.length}
                    </Text>
                    <Text style={styles.footerText}>
                      Remnant: {layout.remaining}"
                    </Text>
                    <Text style={styles.footerText}>
                      Efficiency: {layout.efficiency.toFixed(1)}%
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const MetricCard = ({ label, value }: any) => (
  <View style={styles.metricCard}>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </View>
);
const styles = StyleSheet.create({
  headerContainer: {
    paddingBottom: 15,
  },
  headerBackground: {
    backgroundColor: "#f8f9fa",
    paddingTop: 60,
    paddingBottom: 30,
    borderBottomLeftRadius: 25,
    borderBottomRightRadius: 25,
    overflow: "hidden",
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 300,
    height: 40,
  },
  sharelogo: {
    width: 50,
    height: 40,
    backgroundColor: "#f8f9fa",
  },

  titleContainer: {
    alignItems: "center",
    position: "relative",
    zIndex: 2,
  },
  titleMain: {},

  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#fff",
    marginHorizontal: 20,
    marginTop: -20,
    borderRadius: 15,
    elevation: 8,
    shadowColor: "#f97316",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    overflow: "hidden",
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: "transparent",
    position: "relative",
  },
  tabActive: {
    backgroundColor: "#f97316",
  },
  tabPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  tabContent: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  tabIcon: {
    marginBottom: 2,
  },
  tabtext: {
    color: "#f97316",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  tabtextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  activeIndicator: {
    position: "absolute",
    bottom: 0,
    width: "40%",
    height: 3,
    backgroundColor: "#fff",
    borderRadius: 2,
  },
  section: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  inputCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  inputRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  inputGroup: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#4b5563",
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    // borderWidth: 1,
    // borderColor: "#e5e7eb",
    // borderRadius: 8,
    overflow: "hidden",
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    color: "#1f2937",
    backgroundColor: "#f9fafb",
  },
  inputUnit: {
    paddingHorizontal: 12,
    fontSize: 14,
    color: "#6b7280",
    backgroundColor: "#f3f4f6",
  },
  addButton: {
    backgroundColor: "#f97316",
    borderRadius: 8,
    paddingVertical: 12,
  },
  addButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  addButtonContent: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  addButtonIcon: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  addButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  tableContainer: {
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f9fafb",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  tableHeaderText: {
    flex: 1,
    textAlign: "center",
    fontWeight: "600",
    color: "#4b5563",
    fontSize: 14,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  tableCell: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  tableCellText: {
    fontSize: 15,
    color: "#1f2937",
    fontWeight: "500",
  },
  stockBadge: {
    backgroundColor: "#d1fae5",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 40,
  },
  lowStockBadge: {
    backgroundColor: "#fee2e2",
  },
  stockBadgeText: {
    color: "#065f46",
    fontWeight: "600",
    textAlign: "center",
  },
  deleteButton: {
    backgroundColor: "#fee2e2",
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  deleteButtonPressed: {
    transform: [{ scale: 0.9 }],
  },
  deleteButtonIcon: {
    color: "#dc2626",
    fontSize: 16,
    fontWeight: "bold",
  },
  emptyState: {
    paddingVertical: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyStateIconContainer: {
    backgroundColor: "#f3f4f6",
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  emptyStateIcon: {
    fontSize: 28,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 4,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    paddingHorizontal: 40,
  },

  actionButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 24,
    marginBottom: 10,
    marginHorizontal: 16,
    gap: 16,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  optimizeButton: {
    flex: 1,
    backgroundColor: "#f97316",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowColor: "#f97316",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  optimizeButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    backgroundColor: "#9ca3af",
    shadowColor: "#6b7280",
    opacity: 0.7,
  },
  optimizeButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  optimizeButtonIcon: {
    fontSize: 18,
  },
  resetButton: {
    flex: 1,
    backgroundColor: "#fff",
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
    paddingBottom: 16,
    justifyContent: "center",
  },
  resetButtonPressed: {
    backgroundColor: "#f3f4f6",
    transform: [{ scale: 0.98 }],
  },
  resetButtonText: {
    color: "#4b5563",
    fontSize: 16,
    fontWeight: "600",
  },
  resetButtonIcon: {
    fontSize: 18,
    color: "#4b5563",
  },
  resultsSection: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  resultsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  resultsSectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1f2937",
  },

  successBadge: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center", // Centered button
  },
  successBadgeText: {
    // color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },
  shareIcon: {
    marginRight: 8,
    fontSize: 16,
    color: "#fff",
  },

  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  statCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    flex: 1,
    marginHorizontal: 4,
    alignItems: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statNumber: {
    fontSize: 20,
    fontWeight: "700",
    color: "#f97316",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: "#6b7280",
  },
  resultsTable: {
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    elevation: 2,
    marginHorizontal: 4,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#f9fafb",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  headerText: {
    fontWeight: "600",
    color: "#4b5563",
    fontSize: 14,
    textAlign: "center",
    flex: 1,
  },

  evenRow: {
    backgroundColor: "#f9fafb",
  },
  quantityBadge: {
    backgroundColor: "#dbeafe",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 32,
  },
  pipeSizeText: {
    fontWeight: "600",
    color: "#1f2937",
  },
  cutsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
  },
  cutPill: {
    backgroundColor: "#e5e7eb",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  cutText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#1f2937",
  },

  quantityText: {
    color: "#1e40af",
    fontWeight: "600",
    textAlign: "center",
  },
  quantityBadgeText: {
    color: "#1e40af",
    fontWeight: "600",
    textAlign: "center",
  },
  wasteText: {
    fontWeight: "500",
    color: "#dc2626",
  },
  totalRow: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  totalText: {
    fontWeight: "700",
    color: "#1f2937",
    textAlign: "center",
    flex: 1,
  },
  safe: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },

  subtitle: {
    fontSize: 16,
    color: "#bfdbfe",
    textAlign: "center",
    fontWeight: "500",
  },

  header: {
    paddingTop: 50,
    paddingBottom: 25,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 25,
    borderBottomRightRadius: 25,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.1)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
    letterSpacing: 0.5,
  },

  scrollView: {
    flex: 1,
    marginTop: 20,
    backgroundColor: "#f8fafc", // ✅ Fix
  },

  sectionSubtitle: {
    fontSize: 16,
    color: "#64748b",
    marginBottom: 20,
  },

  // Summary Table Styles
  summaryTable: {
    borderRadius: 16,
    overflow: "hidden",
    shadowRadius: 8,
  },

  summaryCell: {
    flex: 1,
    alignItems: "center",
  },
  summaryCellText: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  wasteCellText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ef4444",
    textAlign: "center",
  },

  totalCellText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#1e293b",
    textAlign: "center",
  },
  totalWasteCellText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#ef4444",
    textAlign: "center",
  },

  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  metricCard: {
    width: "48%",
    // backgroundColor: "#fef3c7", // Soft warm background
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
    borderColor: "#fcd34d",
    borderWidth: 1,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#f97316",
  },
  metricLabel: {
    fontSize: 12,
    color: "#6b7280",
  },

  layoutCard: {
    padding: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    marginBottom: 16,
    // backgroundColor: "#fff", // Clean white background
  },
  layoutId: {
    fontWeight: "bold",
    marginBottom: 4,
    color: "#111827",
  },
  layoutInfo: {
    fontSize: 14,
    color: "#f97316",
    marginBottom: 8,
  },

  cutRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  cutLabel: {
    fontSize: 14,
    color: "#374151",
  },
  cutQty: {
    fontWeight: "600",
    color: "#f97316", // Orange emphasis
  },

  cutBar: {
    flexDirection: "row",
    marginVertical: 8,
    flexWrap: "wrap",
  },
  cutBlock: {
    backgroundColor: "#f97316", // Highlight color
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 4,
    margin: 2,
  },
  cutBlockText: {
    fontSize: 12,
    color: "#fff",
  },

  layoutFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  footerText: {
    fontSize: 12,
    color: "#6b7280",
  },

  summarySection: {
    marginBottom: 16,
    padding: 10,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 8,
  },

  summaryHeader: {
    flexDirection: "row",
    paddingVertical: 6,
    backgroundColor: "#f9fafb",
    borderBottomWidth: 1,
  },

  summaryHeaderText: {
    width: "33.33%",
    fontSize: 14,
    fontWeight: "600",
    color: "#6b7280",
    textAlign: "center",
  },

  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderColor: "#f3f4f6",
  },

  summaryLabel: {
    width: "33.33%",
    fontSize: 14,
    color: "#374151",
    textAlign: "center",
    paddingLeft: 4,
  },

  summaryValue: {
    width: "33.33%",
    fontSize: 14,
    color: "#111827",
    textAlign: "center",
  },

  summaryQty: {
    width: "33.33%",
    fontSize: 14,
    fontWeight: "600",
    color: "#f97316",
    textAlign: "center",
    paddingRight: 4,
  },

  summaryTotalRow: {
    flexDirection: "row",
    paddingVertical: 6,
    borderTopWidth: 1,
    borderColor: "#e5e7eb",
    marginTop: 6,
    paddingTop: 8,
  },
  // Footer Styles
  footerContainer: {
    position: "absolute",
    bottom: -200,
    left: 0,
    right: 0,
    paddingVertical: 15,
    paddingHorizontal: 20,

    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF6B00",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  backButtonIcon: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
    marginRight: 8,
  },
  backButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});

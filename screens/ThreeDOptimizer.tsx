import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
  Alert,
} from "react-native";

// Types
interface StockGlass {
  name: string;
  w: number;
  h: number;
  qty: number;
}

interface CutDemand {
  name: string;
  w: number;
  h: number;
  qty: number;
}

interface Stock {
  id: number;
  name: string;
  w: number;
  h: number;
  qty: number;
  area: number;
  original_qty: number;
}

interface Cut {
  id: number;
  name: string;
  w: number;
  h: number;
  qty: number;
  area: number;
}

interface CutInfo {
  cut_id: number;
  cut_name: string;
  cut_size: [number, number];
  cut_qty: number;
  sheets_used: number;
  rotated: boolean;
  layout: string;
  cuts_per_sheet: number;
  waste_per_sheet: number;
  total_waste: number;
  efficiency: number;
}

interface SheetDetail {
  sheet_number: number;
  cuts: Array<{
    name: string;
    size: string;
    quantity: number;
    rotated: boolean;
    layout: string;
  }>;
  used_area: number;
  waste_area: number;
  efficiency: number;
}

interface UsageSummary {
  [key: string]: {
    name: string;
    size: string;
    total_qty: number;
    used: number;
    remaining: number;
    cuts: CutInfo[];
    total_area: number;
    used_area: number;
    waste_area: number;
    efficiency: number;
    sheet_details: SheetDetail[];
  };
}

interface UnfulfilledCut {
  name: string;
  size: string;
  required: number;
  fulfilled: number;
  unfulfilled: number;
}

interface OptimizationResult {
  usage_summary: UsageSummary;
  unfulfilled_cuts: UnfulfilledCut[];
  statistics: {
    total_sheets_used: number;
    total_used_area: number;
    total_waste_area: number;
    overall_efficiency: number;
  };
}
interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SheetCut {
  name: string;
  size: string;
  quantity: number;
  rotated: boolean;
  layout: string;
}

const ThreeDOptimizer = () => {
  const [stockGlass, setStockGlass] = useState<StockGlass[]>([
    { name: "Standard Sheet", w: 1000, h: 2000, qty: 10 },
  ]);
  const [cutDemand, setCutDemand] = useState<CutDemand[]>([
    { name: "Window A", w: 400, h: 600, qty: 5 },
  ]);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [activeTab, setActiveTab] = useState<
    "input" | "results" | "visualization"
  >("input");

  const computeOptimization = (
    stockGlass: StockGlass[],
    cutDemand: CutDemand[]
  ): OptimizationResult => {
    const stocks: Stock[] = [];
    const cuts: Cut[] = [];

    stockGlass.forEach((stock, i) => {
      stocks.push({
        id: i,
        name: stock.name,
        w: stock.w,
        h: stock.h,
        qty: stock.qty,
        area: stock.w * stock.h,
        original_qty: stock.qty,
      });
    });

    cutDemand.forEach((cut, j) => {
      cuts.push({
        id: j,
        name: cut.name,
        w: cut.w,
        h: cut.h,
        qty: cut.qty,
        area: cut.w * cut.h,
      });
    });

    cuts.sort((a, b) => b.area - a.area);

    const usage_summary: UsageSummary = {};
    const reusableAreas: { w: number; h: number; stockId: number }[] = [];

    stocks.forEach((s) => {
      usage_summary[String(s.id)] = {
        name: s.name,
        size: `${s.w}×${s.h}`,
        total_qty: s.qty,
        used: 0,
        remaining: s.qty,
        cuts: [],
        total_area: s.area,
        used_area: 0,
        waste_area: 0,
        efficiency: 0,
        sheet_details: [],
      };
    });

    const unfulfilled_cuts: UnfulfilledCut[] = [];

    cuts.forEach((cut) => {
      let remaining_qty = cut.qty;
      let cut_fulfilled = 0;

      // First, try to fulfill from reusable areas (waste)
      for (let i = reusableAreas.length - 1; i >= 0 && remaining_qty > 0; i--) {
        const area = reusableAreas[i];
        const stockKey = String(area.stockId);

        const fit_normal =
          Math.floor(area.w / cut.w) * Math.floor(area.h / cut.h);
        const fit_rotated =
          Math.floor(area.w / cut.h) * Math.floor(area.h / cut.w);

        let cuts_possible = 0;
        let rotated = false;

        if (fit_rotated > fit_normal) {
          cuts_possible = fit_rotated;
          rotated = true;
        } else {
          cuts_possible = fit_normal;
        }

        if (cuts_possible > 0) {
          const cuts_used = Math.min(cuts_possible, remaining_qty);
          const cut_area =
            (rotated ? cut.h * cut.w : cut.w * cut.h) * cuts_used;

          usage_summary[stockKey].cuts.push({
            cut_id: cut.id,
            cut_name: cut.name,
            cut_size: rotated ? [cut.h, cut.w] : [cut.w, cut.h],
            cut_qty: cuts_used,
            sheets_used: 0, // reuse
            rotated,
            layout: "waste reuse",
            cuts_per_sheet: cuts_possible,
            waste_per_sheet: 0,
            total_waste: 0,
            efficiency: 100,
          });

          usage_summary[stockKey].used_area += cut_area;

          remaining_qty -= cuts_used;
          cut_fulfilled += cuts_used;

          // Remove used waste
          reusableAreas.splice(i, 1);
        }
      }

      // Now try to fulfill from stock sheets
      const sortedStocks = [...stocks].sort((a, b) => b.area - a.area);

      for (const stock of sortedStocks) {
        if (remaining_qty <= 0) break;

        const stockKey = String(stock.id);
        const available_sheets = stock.qty - usage_summary[stockKey].used;
        if (available_sheets <= 0) continue;

        const fit_w1 = Math.floor(stock.w / cut.w);
        const fit_h1 = Math.floor(stock.h / cut.h);
        const cuts_normal = fit_w1 * fit_h1;

        const fit_w2 = Math.floor(stock.w / cut.h);
        const fit_h2 = Math.floor(stock.h / cut.w);
        const cuts_rotated = fit_w2 * fit_h2;

        let cuts_per_sheet: number;
        let rotation_used: boolean;
        let layout: string;
        let cut_w: number, cut_h: number;

        if (cuts_rotated > cuts_normal) {
          cuts_per_sheet = cuts_rotated;
          rotation_used = true;
          layout = `${fit_w2}×${fit_h2}`;
          cut_w = cut.h;
          cut_h = cut.w;
        } else {
          cuts_per_sheet = cuts_normal;
          rotation_used = false;
          layout = `${fit_w1}×${fit_h1}`;
          cut_w = cut.w;
          cut_h = cut.h;
        }

        if (cuts_per_sheet === 0) continue;

        const sheets_needed = Math.ceil(remaining_qty / cuts_per_sheet);
        const sheets_available = Math.min(sheets_needed, available_sheets);
        if (sheets_available <= 0) continue;

        let cuts_made = 0;
        let total_waste = 0;
        const cut_area = cut_w * cut_h;

        for (let sheet_num = 0; sheet_num < sheets_available; sheet_num++) {
          const cuts_on_this_sheet = Math.min(
            cuts_per_sheet,
            remaining_qty - cuts_made
          );
          if (cuts_on_this_sheet > 0) {
            cuts_made += cuts_on_this_sheet;
            const sheet_cut_area = cuts_on_this_sheet * cut_area;
            const sheet_waste = stock.area - sheet_cut_area;
            total_waste += sheet_waste;

            usage_summary[stockKey].sheet_details.push({
              sheet_number: usage_summary[stockKey].used + sheet_num + 1,
              cuts: [
                {
                  name: cut.name,
                  size: `${cut_w}×${cut_h}`,
                  quantity: cuts_on_this_sheet,
                  rotated: rotation_used,
                  layout,
                },
              ],
              used_area: sheet_cut_area,
              waste_area: sheet_waste,
              efficiency:
                Math.round((sheet_cut_area / stock.area) * 100 * 100) / 100,
            });

            // Save leftover area to reuse
            reusableAreas.push({
              w: stock.w,
              h: stock.h,
              stockId: stock.id,
            });
          }
        }

        const cut_info: CutInfo = {
          cut_id: cut.id,
          cut_name: cut.name,
          cut_size: [cut_w, cut_h],
          cut_qty: cuts_made,
          sheets_used: sheets_available,
          rotated: rotation_used,
          layout,
          cuts_per_sheet,
          waste_per_sheet: total_waste / sheets_available,
          total_waste: total_waste,
          efficiency:
            Math.round(
              ((cuts_made * cut_area) / (stock.area * sheets_available)) *
                100 *
                100
            ) / 100,
        };

        usage_summary[stockKey].cuts.push(cut_info);
        usage_summary[stockKey].used += sheets_available;
        usage_summary[stockKey].remaining -= sheets_available;
        usage_summary[stockKey].used_area += cuts_made * cut_area;
        usage_summary[stockKey].waste_area += total_waste;

        remaining_qty -= cuts_made;
        cut_fulfilled += cuts_made;
      }

      if (remaining_qty > 0) {
        unfulfilled_cuts.push({
          name: cut.name,
          size: `${cut.w}×${cut.h}`,
          required: cut.qty,
          fulfilled: cut_fulfilled,
          unfulfilled: remaining_qty,
        });
      }
    });

    // Final efficiency calculations
    Object.entries(usage_summary).forEach(([_, summary]) => {
      if (summary.used > 0) {
        const total_stock_area = summary.total_area * summary.used;
        summary.efficiency =
          Math.round((summary.used_area / total_stock_area) * 100 * 100) / 100;
      }
    });

    const total_sheets_used = Object.values(usage_summary).reduce(
      (sum, s) => sum + s.used,
      0
    );
    const total_used_area = Object.values(usage_summary).reduce(
      (sum, s) => sum + s.used_area,
      0
    );
    const total_waste_area = Object.values(usage_summary).reduce(
      (sum, s) => sum + s.waste_area,
      0
    );
    const overall_efficiency =
      total_used_area + total_waste_area > 0
        ? (total_used_area / (total_used_area + total_waste_area)) * 100
        : 0;

    return {
      usage_summary,
      unfulfilled_cuts,
      statistics: {
        total_sheets_used,
        total_used_area: Math.round(total_used_area * 100) / 100,
        total_waste_area: Math.round(total_waste_area * 100) / 100,
        overall_efficiency: Math.round(overall_efficiency * 100) / 100,
      },
    };
  };

  const handleOptimize = () => {
    try {
      const result = computeOptimization(stockGlass, cutDemand);
      setResult(result);
      setActiveTab("results");
    } catch (error) {
      console.error("Optimization error:", error);
      Alert.alert(
        "Error",
        "Error during optimization. Please check your inputs."
      );
    }
  };

  const addStockGlass = () => {
    setStockGlass([...stockGlass, { name: "", w: 0, h: 0, qty: 0 }]);
  };

  const removeStockGlass = (index: number) => {
    setStockGlass(stockGlass.filter((_, i) => i !== index));
  };

  const updateStockGlass = (
    index: number,
    field: keyof StockGlass,
    value: string | number
  ) => {
    const updated = [...stockGlass];
    updated[index] = { ...updated[index], [field]: value };
    setStockGlass(updated);
  };

  const addCutDemand = () => {
    setCutDemand([...cutDemand, { name: "", w: 0, h: 0, qty: 0 }]);
  };

  const removeCutDemand = (index: number) => {
    setCutDemand(cutDemand.filter((_, i) => i !== index));
  };

  const updateCutDemand = (
    index: number,
    field: keyof CutDemand,
    value: string | number
  ) => {
    const updated = [...cutDemand];
    updated[index] = { ...updated[index], [field]: value };
    setCutDemand(updated);
  };

  const renderInputRow = (
    item: StockGlass | CutDemand,
    index: number,
    type: "stock" | "cut"
  ) => {
    const updateFn = type === "stock" ? updateStockGlass : updateCutDemand;
    const removeFn = type === "stock" ? removeStockGlass : removeCutDemand;

    return (
      <View key={index} style={styles.inputRow}>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Name</Text>
          <TextInput
            style={styles.textInput}
            value={item.name}
            onChangeText={(value) => updateFn(index, "name", value)}
            placeholder="Enter name"
          />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Width</Text>
          <TextInput
            style={styles.numberInput}
            value={item.w.toString()}
            onChangeText={(value) => updateFn(index, "w", Number(value) || 0)}
            placeholder="0"
            keyboardType="numeric"
          />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Height</Text>
          <TextInput
            style={styles.numberInput}
            value={item.h.toString()}
            onChangeText={(value) => updateFn(index, "h", Number(value) || 0)}
            placeholder="0"
            keyboardType="numeric"
          />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Quantity</Text>
          <TextInput
            style={styles.numberInput}
            value={item.qty.toString()}
            onChangeText={(value) => updateFn(index, "qty", Number(value) || 0)}
            placeholder="0"
            keyboardType="numeric"
          />
        </View>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => removeFn(index)}
        >
          <Text style={styles.deleteButtonText}>Delete</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderVisualization = () => {
    if (!result) return null;

    return (
      <ScrollView style={styles.visualizationContainer}>
        <Text style={styles.visualizationTitle}>
          Sheet Layout Visualization
        </Text>

        {Object.entries(result.usage_summary).map(
          ([stockId, summary]) =>
            summary.used > 0 && (
              <View key={stockId} style={styles.visualizationItem}>
                <Text style={styles.visualizationItemTitle}>
                  {summary.name} ({summary.size}) - {summary.used} sheets used
                </Text>

                <View style={styles.sheetGrid}>
                  {summary.sheet_details.map((sheet, index) => (
                    <View key={index} style={styles.sheetContainer}>
                      <Text style={styles.sheetTitle}>
                        Sheet #{sheet.sheet_number}
                      </Text>

                      <View style={styles.sheetVisualization}>
                        <View style={styles.sheetContent}>
                          <Text style={styles.sheetSizeText}>
                            {summary.size}
                          </Text>

                          {sheet.cuts.map((cut, cutIndex) => (
                            <View key={cutIndex} style={styles.cutInfo}>
                              <Text style={styles.cutName}>
                                {cut.rotated ? "↻ " : ""}
                                {cut.name}
                              </Text>
                              <Text style={styles.cutDetails}>
                                {cut.size} × {cut.quantity} ({cut.layout})
                              </Text>
                            </View>
                          ))}

                          <Text style={styles.sheetEfficiency}>
                            {sheet.efficiency}% efficient
                          </Text>
                        </View>
                      </View>

                      <View style={styles.sheetStats}>
                        <Text style={styles.sheetStat}>
                          Used: {sheet.used_area.toFixed(0)} sq units
                        </Text>
                        <Text style={styles.sheetStat}>
                          Waste: {sheet.waste_area.toFixed(0)} sq units
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )
        )}
      </ScrollView>
    );
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Glass Cutting Optimizer</Text>

      {/* Tab Navigation */}
      <View style={styles.tabNavigation}>
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === "input" && styles.tabButtonActive,
          ]}
          onPress={() => setActiveTab("input")}
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === "input" && styles.tabButtonTextActive,
            ]}
          >
            Input Data
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === "results" && styles.tabButtonActive,
            !result && styles.tabButtonDisabled,
          ]}
          onPress={() => setActiveTab("results")}
          disabled={!result}
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === "results" && styles.tabButtonTextActive,
              !result && styles.tabButtonTextDisabled,
            ]}
          >
            Results
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === "visualization" && styles.tabButtonActive,
            !result && styles.tabButtonDisabled,
          ]}
          onPress={() => setActiveTab("visualization")}
          disabled={!result}
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === "visualization" && styles.tabButtonTextActive,
              !result && styles.tabButtonTextDisabled,
            ]}
          >
            Visualization
          </Text>
        </TouchableOpacity>
      </View>

      {/* Input Tab */}
      {activeTab === "input" && (
        <View style={styles.inputTab}>
          {/* Stock Glass Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Stock Glass</Text>
              <TouchableOpacity
                onPress={addStockGlass}
                style={styles.addButton}
              >
                <Text style={styles.addButtonText}>Add Stock</Text>
              </TouchableOpacity>
            </View>

            {stockGlass.map((stock, index) =>
              renderInputRow(stock, index, "stock")
            )}
          </View>

          {/* Cut Demand Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Cut Demand</Text>
              <TouchableOpacity onPress={addCutDemand} style={styles.addButton}>
                <Text style={styles.addButtonText}>Add Cut</Text>
              </TouchableOpacity>
            </View>

            {cutDemand.map((cut, index) => renderInputRow(cut, index, "cut"))}
          </View>

          {/* Optimize Button */}
          <View style={styles.optimizeButtonContainer}>
            <TouchableOpacity
              onPress={handleOptimize}
              style={styles.optimizeButton}
            >
              <Text style={styles.optimizeButtonText}>Optimize Cuts</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Results Tab */}
      {activeTab === "results" && result && (
        <View style={styles.resultsTab}>
          {/* Statistics */}
          <View style={styles.statisticsSection}>
            <Text style={styles.statisticsTitle}>Overall Statistics</Text>
            <View style={styles.statisticsGrid}>
              <View style={styles.statisticItem}>
                <Text style={[styles.statisticValue, { color: "#3b82f6" }]}>
                  {result.statistics.total_sheets_used}
                </Text>
                <Text style={styles.statisticLabel}>Total Sheets Used</Text>
              </View>
              <View style={styles.statisticItem}>
                <Text style={[styles.statisticValue, { color: "#10b981" }]}>
                  {result.statistics.total_used_area.toLocaleString()}
                </Text>
                <Text style={styles.statisticLabel}>Used Area</Text>
              </View>
              <View style={styles.statisticItem}>
                <Text style={[styles.statisticValue, { color: "#ef4444" }]}>
                  {result.statistics.total_waste_area.toLocaleString()}
                </Text>
                <Text style={styles.statisticLabel}>Waste Area</Text>
              </View>
              <View style={styles.statisticItem}>
                <Text style={[styles.statisticValue, { color: "#8b5cf6" }]}>
                  {result.statistics.overall_efficiency}%
                </Text>
                <Text style={styles.statisticLabel}>Overall Efficiency</Text>
              </View>
            </View>
          </View>

          {/* Usage Summary */}
          <View style={styles.usageSection}>
            <Text style={styles.sectionTitle}>Usage Summary</Text>
            {Object.entries(result.usage_summary).map(([stockId, summary]) => (
              <View key={stockId} style={styles.usageItem}>
                <View style={styles.usageHeader}>
                  <View>
                    <Text style={styles.usageName}>{summary.name}</Text>
                    <Text style={styles.usageSize}>Size: {summary.size}</Text>
                  </View>
                  <View style={styles.usageStats}>
                    <Text style={styles.usageStat}>
                      Used: {summary.used}/{summary.total_qty} sheets
                    </Text>
                    <Text style={styles.usageEfficiency}>
                      Efficiency: {summary.efficiency}%
                    </Text>
                  </View>
                </View>

                {summary.cuts.length > 0 && (
                  <View style={styles.cutsContainer}>
                    {summary.cuts.map((cut, index) => (
                      <View key={index} style={styles.cutItem}>
                        <Text style={styles.cutItemText}>
                          {cut.cut_name} - {cut.cut_size[0]}×{cut.cut_size[1]} ×{" "}
                          {cut.cut_qty}
                        </Text>
                        <Text style={styles.cutItemDetails}>
                          Layout: {cut.layout} | Rotated:{" "}
                          {cut.rotated ? "Yes" : "No"} | Efficiency:{" "}
                          {cut.efficiency}%
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>

          {/* Unfulfilled Cuts */}
          {result.unfulfilled_cuts.length > 0 && (
            <View style={styles.unfulfilledSection}>
              <Text style={styles.unfulfilledTitle}>Unfulfilled Cuts</Text>
              {result.unfulfilled_cuts.map((cut, index) => (
                <View key={index} style={styles.unfulfilledItem}>
                  <Text style={styles.unfulfilledItemText}>
                    {cut.name} ({cut.size}) - Required: {cut.required},
                    Fulfilled: {cut.fulfilled}
                  </Text>
                  <Text style={styles.unfulfilledCount}>
                    Unfulfilled: {cut.unfulfilled}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Visualization Tab */}
      {activeTab === "visualization" && result && renderVisualization()}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 24,
    textAlign: "center",
    color: "#1e293b",
  },

  // Tab Navigation
  tabNavigation: {
    flexDirection: "row",
    marginBottom: 24,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#e2e8f0",
    padding: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  tabButtonActive: {
    backgroundColor: "white",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  tabButtonDisabled: {
    opacity: 0.6,
  },
  tabButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748b",
  },
  tabButtonTextActive: {
    color: "#3b82f6",
  },
  tabButtonTextDisabled: {
    color: "#94a3b8",
  },

  // Input Tab
  inputTab: {
    flex: 1,
  },
  section: {
    marginBottom: 28,
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1e293b",
  },
  addButton: {
    backgroundColor: "#3b82f6",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  addButtonText: {
    color: "white",
    fontWeight: "500",
    fontSize: 14,
  },
  inputRow: {
    backgroundColor: "#f8fafc",
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 6,
    color: "#475569",
  },
  textInput: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "white",
    fontSize: 16,
    color: "#1e293b",
  },
  numberInput: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "white",
    fontSize: 16,
    color: "#1e293b",
  },
  deleteButton: {
    backgroundColor: "#fee2e2",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignSelf: "flex-start",
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  deleteButtonText: {
    color: "#dc2626",
    fontSize: 14,
    fontWeight: "500",
  },
  optimizeButtonContainer: {
    marginTop: 24,
  },
  optimizeButton: {
    backgroundColor: "#3b82f6",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: "#2563eb",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  optimizeButtonText: {
    color: "white",
    fontSize: 18,
    fontWeight: "600",
  },

  // Results Tab
  resultsTab: {
    flex: 1,
  },
  statisticsSection: {
    backgroundColor: "white",
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  statisticsTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
    color: "#1e293b",
  },
  statisticsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12,
  },
  statisticItem: {
    width: "48%",
    backgroundColor: "#f8fafc",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  statisticValue: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 4,
  },
  statisticLabel: {
    fontSize: 12,
    color: "#64748b",
    textAlign: "center",
  },
  usageSection: {
    marginBottom: 20,
  },
  usageItem: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  usageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  usageName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1e40af",
  },
  usageSize: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 2,
  },
  usageStats: {
    alignItems: "flex-end",
  },
  usageStat: {
    fontSize: 14,
    color: "#1e293b",
  },
  usageEfficiency: {
    fontSize: 14,
    color: "#10b981",
    fontWeight: "600",
    marginTop: 4,
  },
  cutsContainer: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 12,
  },
  cutItem: {
    backgroundColor: "#f1f5f9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  cutItemText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#1e293b",
  },
  cutItemDetails: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 4,
  },
  unfulfilledSection: {
    backgroundColor: "#fff1f2",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ffe4e6",
  },
  unfulfilledTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
    color: "#b91c1c",
  },
  unfulfilledItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#fecdd3",
  },
  unfulfilledItemText: {
    fontSize: 14,
    color: "#475569",
    flex: 1,
    marginRight: 8,
  },
  unfulfilledCount: {
    fontSize: 14,
    color: "#ef4444",
    fontWeight: "600",
  },

  // Visualization Tab
  visualizationContainer: {
    flex: 1,
  },
  visualizationTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
    color: "#1e293b",
  },
  visualizationItem: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  visualizationItemTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
    color: "#1e293b",
  },
  sheetGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12,
  },
  sheetContainer: {
    width: "48%",
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  sheetTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    color: "#1e293b",
  },
  sheetVisualization: {
    aspectRatio: 1,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
    marginBottom: 8,
    position: "relative",
    overflow: "hidden",
  },
  sheetContent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheetSizeText: {
    fontSize: 10,
    color: "#64748b",
    marginBottom: 4,
  },
  cutInfo: {
    marginBottom: 4,
  },
  cutName: {
    fontSize: 10,
    fontWeight: "500",
    color: "#1e293b",
  },
  cutDetails: {
    fontSize: 10,
    color: "#64748b",
  },
  sheetEfficiency: {
    position: "absolute",
    bottom: 4,
    right: 4,
    fontSize: 10,
    color: "#3b82f6",
    fontWeight: "600",
    backgroundColor: "rgba(255,255,255,0.9)",
    paddingHorizontal: 4,
    borderRadius: 2,
  },
  sheetStats: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  sheetStat: {
    fontSize: 12,
    color: "#64748b",
  },
});

export default ThreeDOptimizer;

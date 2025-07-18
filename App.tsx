import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
} from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import ThreeDOptimizer from "./screens/ThreeDOptimizer";
import TwoDOptimizer from "./screens/TwoDOptimizer";
import { Image } from "react-native";

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main">
          {({ navigation }) => (
            <View style={styles.container}>
              {/* Logo at the top */}
              <View style={styles.logoContainer}>
                <Image
                  source={require("./assets/aavishkruti-logo.png")}
                  style={styles.logo}
                  resizeMode="contain"
                />
              </View>

              {/* Main content vertically centered */}
              <View style={styles.content}>
                <StatusBar barStyle="light-content" backgroundColor="#FF6B00" />
                <Text style={styles.title}>Choose Optimizer</Text>

                <TouchableOpacity
                  style={styles.card}
                  onPress={() => navigation.navigate("TwoD")}
                >
                  <Text style={styles.cardText}>1D Optimizer</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.card}
                  onPress={() => navigation.navigate("ThreeD")}
                >
                  <Text style={styles.cardText}>2D Optimizer</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Stack.Screen>

        <Stack.Screen name="TwoD" component={TwoDOptimizer} />
        <Stack.Screen name="ThreeD" component={ThreeDOptimizer} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFF4E9",
  },

  logoContainer: {
    alignItems: "center",
    paddingTop: 40, // adjust as needed
  },

  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },

  logo: {
    width: 300,
    height: 40,
  },

  title: {
    fontSize: 26,
    fontWeight: "bold",
    marginBottom: 30,
    color: "#FF6B00",
  },

  card: {
    width: "100%",
    padding: 18,
    backgroundColor: "#FF6B00",
    borderRadius: 12,
    marginVertical: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 5,
  },

  cardText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
});

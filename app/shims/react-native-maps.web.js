import React from "react";
import { View, Text } from "react-native";

const Box = ({ children }) => (
  <View
    style={{
      width: "100%",
      height: 240,
      borderRadius: 16,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: "rgba(0,0,0,0.08)",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.03)"
    }}
  >
    {children}
  </View>
);

export default function MapView(props) {
  return (
    <Box>
      <Text style={{ opacity: 0.7, fontSize: 14 }}>
        Map is not supported on Web yet.
      </Text>
      {props.children}
    </Box>
  );
}

export const Marker = ({ title }) => (
  <View style={{ marginTop: 10 }}>
    <Text style={{ opacity: 0.7, fontSize: 12 }}>
      {title ? `📍 ${title}` : "📍 Marker"}
    </Text>
  </View>
);

export const PROVIDER_GOOGLE = "google";
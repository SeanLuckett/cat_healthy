import { useState } from "react";
import { AppShell, Tabs } from "@mantine/core";
import TodayScreen from "./pages/TodayScreen";
import WeightScreen from "./pages/WeightScreen";

const App = () => {
  const [tab, setTab] = useState<string | null>("today");

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Tabs value={tab} onChange={setTab} px="md">
          <Tabs.List>
            <Tabs.Tab value="today">Today</Tabs.Tab>
            <Tabs.Tab value="weight">Weight</Tabs.Tab>
          </Tabs.List>
        </Tabs>
      </AppShell.Header>
      <AppShell.Main>
        {tab === "today" && <TodayScreen />}
        {tab === "weight" && <WeightScreen />}
      </AppShell.Main>
    </AppShell>
  );
};

export default App;

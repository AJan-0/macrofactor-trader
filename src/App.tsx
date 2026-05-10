import { AppProvider } from "./store/appStore";
import Dashboard from "./pages/Dashboard";

export default function App() {
  return (
    <AppProvider>
      <Dashboard />
    </AppProvider>
  );
}

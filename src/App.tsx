import { Route, Routes } from 'react-router';
import './App.css';
import { InventoryPage } from './pages/InventoryPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';

export default function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<InventoryPage />} />
        <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
        <Route path="*" element={<VehicleDetailPage />} />
      </Routes>
    </div>
  );
}

import { Navigate, Routes, Route } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import GamePage from './pages/GamePage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<GamePage />} />
      <Route path="/play" element={<GamePage />} />
      <Route path="/play/:roomId" element={<Navigate to="/play" replace />} />
      <Route
        path="/default"
        element={<Navigate to={{ pathname: '/', search: '?loadDefault=1' }} replace />}
      />
      <Route path="/dashboard" element={<DashboardPage />} />
    </Routes>
  )
}

import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { Stethoscope } from 'lucide-react';
import AdminPage from './pages/admin';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ProfileSettings from './pages/ProfileSettings';
import MyCases from './pages/MyCases';
import AdminStudents from './pages/AdminStudents';
import AdminStudentCases from './pages/AdminStudentCases';
import AdminDashboard from './pages/AdminDashboard';
import CaseManager from './pages/CaseManager';
import RoomManagement from './pages/RoomManagement';
import FeedbackProcessor from './components/FeedbackProcessor';
import AssignmentView from './pages/AssignmentView';
import Landing from './pages/Landing';
import AssignmentManager from './pages/AssignmentManager';
import EmrDashboard from './pages/EmrDashboard';
import CaseBuilder from './pages/CaseBuilder';
import AdminPatients from './pages/AdminPatients';
import TestRooms from './pages/TestRooms';
import SuperAdminPortal from './pages/SuperAdminPortal';
import { hasAdminAccess, isSuperAdmin, isTestUser } from './lib/roles';

function App() {
  const { user, loading, loadUser, profile } = useAuthStore();
  const hasAdmin = hasAdminAccess(profile);
  const isTester = isTestUser(profile);
  const superAdmin = isSuperAdmin(profile);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <Stethoscope className="w-12 h-12 mx-auto mb-4 text-blue-600 animate-pulse" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <FeedbackProcessor />
      <Routes>
        <Route 
          path="/" 
          element={
            user ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Landing />
            )
          } 
        />
        <Route 
          path="/login" 
          element={user ? <Navigate to="/dashboard" replace /> : <Login />} 
        />
        <Route 
          path="/register" 
          element={user ? <Navigate to="/dashboard" replace /> : <Register />} 
        />
        <Route 
          path="/forgot-password" 
          element={user ? <Navigate to="/dashboard" replace /> : <ForgotPassword />} 
        />
        <Route 
          path="/reset-password" 
          element={<ResetPassword />} 
        />
        <Route 
          path="/dashboard" 
          element={
            user ? (
              isTester ? <TestRooms /> : <AdminDashboard />
            ) : (
              <Navigate to="/login" replace />
            )
          } 
        />
        <Route 
          path="/emr" 
          element={user ? <EmrDashboard /> : <Navigate to="/login" replace />} 
        />
        <Route 
          path="/rooms" 
          element={user ? <EmrDashboard /> : <Navigate to="/login" replace />} 
        />
        <Route 
          path="/ehr" 
          element={user ? <EmrDashboard /> : <Navigate to="/login" replace />} 
        />
        <Route 
          path="/admin" 
          element={
            user?.id && hasAdmin ? (
              <AdminPage />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          } 
        />
        <Route 
          path="/admin-dashboard" 
          element={
            user?.id && hasAdmin ? (
              <AdminDashboard />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          } 
        />
        <Route 
          path="/cases/:caseId/manage" 
          element={
            user?.id && hasAdmin ? (
              <CaseManager />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          } 
        />
        <Route 
          path="/profile" 
          element={user ? <ProfileSettings /> : <Navigate to="/login" replace />} 
        />
        <Route
          path="/cases"
          element={
            user ? (
              isTester ? <TestRooms /> : hasAdmin ? <AdminStudents /> : <MyCases />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/students/:studentId"
          element={
            user?.id && hasAdmin ? (
              <AdminStudentCases />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          }
        />
        <Route 
          path="/admin/rooms" 
          element={
            user?.id && hasAdmin ? (
              <RoomManagement />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          } 
        />
        <Route 
          path="/admin/patients" 
          element={
            user?.id && hasAdmin ? (
              <AdminPatients />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          } 
        />
        <Route 
          path="/admin/assignments" 
          element={
            user?.id && hasAdmin ? (
              <AssignmentManager />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          } 
        />
        <Route 
          path="/admin/case-builder" 
          element={
            user?.id && hasAdmin ? (
              <CaseBuilder />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          } 
        />
        <Route
          path="/test-rooms"
          element={
            user?.id && isTester ? (
              <TestRooms />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          }
        />
        <Route
          path="/superadmin/portal"
          element={
            user?.id && superAdmin ? (
              <SuperAdminPortal />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          }
        />
        <Route 
          path="/assignments" 
          element={user ? <MyCases /> : <Navigate to="/login" replace />} 
        />
        <Route 
          path="/assignment/:assignmentId" 
          element={user ? <AssignmentView /> : <Navigate to="/login" replace />} 
        />
      </Routes>
    </Router>
  );
}

export default App;

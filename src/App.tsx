/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { AdminDataProvider, useAdminData } from "./context/AdminDataContext";
import { AdminLayout } from "./components/layout/AdminLayout";
import { PublicWebsiteView } from "./components/website/PublicWebsiteView";

const AppContent: React.FC = () => {
  const { currentView } = useAdminData();

  if (currentView === "public_website") {
    return <PublicWebsiteView />;
  }

  return <AdminLayout />;
};

export default function App() {
  return (
    <AdminDataProvider>
      <AppContent />
    </AdminDataProvider>
  );
}


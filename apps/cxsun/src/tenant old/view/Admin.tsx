import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../../../../../resources/components/breadcrumb";
import { Separator } from "../../../../../resources/components/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "../../../../../resources/components/sidebar/sidebar";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Dashboard from "../../../../../resources/components/dashboard/Dashboard";
import AppHeader from "../../../../../resources/UIBlocks/header/AppHeader";
import { AppSidebar } from "../../../../../resources/components/sidebar/app-sidebar";
import ScrollToTopButton from "../../../../../resources/components/common/scrolltotopbutton";
import AppFooter from "../../../../../resources/UIBlocks/footer/AppFooter";
import {useAuth} from '../../../../../resources/global/auth/AuthContext'
import { useAppContext } from "../../../../../resources/global/AppContaxt";
import React from "react";
import TenantList from "./Tenant.list";
export default function Admin() {
  const { token } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (token) {
      navigate("/");
    }
  }, [token]);

  const { component } = useParams();
  const { currentComponent, setCurrentComponent } = useAppContext();

  // On mount or when URL changes
  useEffect(() => {
    if (component === undefined) {
      setCurrentComponent("admin");
    } else if (component !== currentComponent) {
      setCurrentComponent(component);
    }
  }, [component]);

  // Update browser tab title
  useEffect(() => {
    if (currentComponent) {
      const titleMap: Record<string, string> = {
        themes: "Theme",
        admin: "Dashboard",
        logo: "Customize Logo",
        sales: "Sales",
        purchase: "Purchase",
        receipt: "Receipt",
        payment: "Payment",
        accountbook: "Account Books",
        task: "Task Manager",
      };
      document.title = titleMap[currentComponent];
    }
  }, [currentComponent]);

  const [compoent] = useState([

    {
      id: "dashboard",
      className: "w-[100%] min-h-full",
      component: <Dashboard />,
    },
     {
      id: "tenants",
      className: "w-[100%] min-h-full",
      component: <TenantList />,
    }
  ]);

  return (
    <SidebarProvider className="flex flex-col min-h-screen bg-dashboard-background text-dashboard-foreground">
      {/* Sticky Docs header */}
      <div className="sticky top-0 z-50 bg-background">
        <AppHeader />
      </div>

      <div className="flex flex-1 min-h-0">
        {/* sidebar */}
        <AppSidebar />

        {/* Content Area */}
        <SidebarInset className="flex flex-col flex-1 min-h-0 overflow-hidden bg-dashboard-background text-dashboard-foreground">
          {/* Subheader with Breadcrumb */}
          <header className="flex mt-2 ml-2 md:ml-0 shrink-0 items-center justify-between gap-2 mr-5 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="-ml-1 **:text-foreground" />
              <Separator
                orientation="vertical"
                className="mr-2 bg-foreground text-background data-[orientation=vertical]:h-4"
              />
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem className="block">
                    <BreadcrumbLink onClick={() => setCurrentComponent("")}>
                      Dashboard
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="block" />
                  <BreadcrumbItem className="block">
                    <BreadcrumbPage className="capitalize">
                      {currentComponent === "admin" ? "" : currentComponent}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
          </header>

          {/* Scrollable Main Area */}
          <main className="flex-1 overflow-auto">
            {component === undefined ? (
              // Render default component (dashboard)
              <div className="w-full min-h-full">
                <Dashboard />
              </div>
            ) : (
              compoent.map((comp, index) =>
                currentComponent === comp.id ? (
                  <div key={index} className={comp.className}>
                    {comp.component}
                  </div>
                ) : null
              )
            )}
          </main>
        </SidebarInset>
      </div>

      <ScrollToTopButton />
      <AppFooter content={"2025 All Rights reserved."} />
    </SidebarProvider>
  );
}

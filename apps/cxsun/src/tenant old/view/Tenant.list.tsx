
import TableForm from "../../../../../resources/UIBlocks/Form/TableForm";
import { ApiList } from "../../../../../resources/components/common/commonform";
import tenants from "../../../json/tenants.json";
import React from "react";

const formApi: ApiList = {
  create: "/api/tenants",
  read: "/api/tenants",
  update: "/api/tenants",
  delete: "/api/tenants",
};

function TenantList() {
  return (
    <div>
      <TableForm
        formName="Tenants"
        formApi={formApi}
        jsonPath={tenants}
        fieldPath="tenants.table"
        multipleEntry={false}
        popup={false}
      />
    </div>
  );
}

export default TenantList;

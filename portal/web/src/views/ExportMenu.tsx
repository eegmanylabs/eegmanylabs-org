// Exports of a view, a widget or a table of the reporting pages (requirement R15.6): CSV, Excel
// and PDF. An export holds what the reader sees, the records their own permissions loaded and the
// properties the view shows, so it never reveals more than the screen. CSV and Excel files are
// written in the browser by the shared package; PDF is the browser's print to PDF, with the print
// stylesheet showing the content alone.
import {
  displayText,
  type EngineContext,
  type ExportCell,
  type ExportTable,
  exportFileStem,
  tableToCsv,
  tableToXlsx,
  type ViewProperty,
  type ViewRecord,
} from "@eegml/shared";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadBytes, downloadText } from "@/utils/download";

const today = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** The records of a view as a table: one column for each property shown, values as the view displays them. */
export function viewTable(
  title: string,
  records: readonly ViewRecord[],
  properties: readonly ViewProperty[],
  context: EngineContext,
): ExportTable {
  return {
    title,
    columns: properties.map((property) => property.name),
    rows: records.map((record) =>
      properties.map((property): ExportCell => {
        const value = record.values[property.id];
        if (typeof value === "number") return value;
        const text = displayText(property, value, context);
        return text === "" ? null : text;
      }),
    ),
  };
}

export function ExportMenu({
  table,
  label = "Export",
}: {
  readonly table: () => ExportTable;
  readonly label?: string;
}) {
  const stem = () => exportFileStem(table().title, today());
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="print:hidden">
          <Download aria-hidden="true" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => downloadText(`${stem()}.csv`, tableToCsv(table()), "text/csv;charset=utf-8")}>
          CSV file
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            downloadBytes(
              `${stem()}.xlsx`,
              tableToXlsx(table()),
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
          }
        >
          Excel workbook
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => window.print()}>PDF, through the print dialogue</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

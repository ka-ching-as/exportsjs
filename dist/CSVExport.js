"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const numeral_1 = __importDefault(require("numeral"));
function localize(l10nString, language) {
    if (!l10nString) {
        return "";
    }
    if (typeof (l10nString) !== "object") {
        return l10nString;
    }
    return l10nString[language] || l10nString["en"] || l10nString[Object.keys(l10nString)[0]];
}
class CSVExport {
    constructor(configuration, elementDict) {
        this.elements = Object.keys(elementDict).map(function (key) {
            return elementDict[key];
        });
        this.configuration = configuration;
        this.itemType = configuration.configuration.item_type || 'sale';
        this.separator = configuration.configuration.csv_separator || ',';
        this.delimiter = configuration.configuration.decimal_separator || '.';
    }
    escape(value) {
        return value.replace(new RegExp(this.separator, 'g'), "\\" + this.separator);
    }
    formatNumber(value) {
        return value.replace(/\./g, this.delimiter);
    }
    removeNewLines(dataValues) {
        for (const key in dataValues) {
            const element = dataValues[key];
            if (typeof element === "string") {
                dataValues[key] = element.replace(/(\r\n|\n|\r)/gm, " ");
            }
        }
    }
    outputHeaders(columns) {
        let headers = [];
        for (const column of columns) {
            headers.push(this.escape(column.header));
        }
        return headers.join(this.separator);
    }
    outputRows(row, columns, element) {
        if (this.itemType === "sale") {
            return this.outputRowsForSale(row, columns, element);
        }
        else if (this.itemType === "register_statement") {
            return this.outputRowsForRegisterStatement(row, columns, element);
        }
        else {
            return [];
        }
    }
    outputRowsForRegisterStatement(row, columns, statement) {
        let output = this.outputRowForRegisterStatement(row, columns, statement);
        if (output !== null) {
            return [output];
        }
        else {
            return [];
        }
    }
    outputRowForRegisterStatement(row, columns, statement) {
        const overrides = {};
        var count = 0;
        return this.outputRowShared(row, columns, statement, overrides, count);
    }
    outputRowShared(row, columns, element, dataValues, count) {
        if (count === 0) {
            return null;
        }
        let values = {};
        for (const key in row.values) {
            values[key] = row.values[key];
        }
        for (const key in dataValues) {
            values[key] = dataValues[key];
        }
        if (row.required_values) {
            var requirementsMet = true;
            for (let index in row.required_values) {
                let required = row.required_values[index];
                if (typeof values[required] === 'undefined') {
                    requirementsMet = false;
                }
            }
            if (!requirementsMet) {
                return null;
            }
        }
        var rowOutput = [];
        for (let index in columns) {
            let column = columns[index];
            if (column.value) {
                let val = (typeof values[column.value] !== 'undefined') ? values[column.value] : "";
                rowOutput.push(val);
            }
            else {
                rowOutput.push("");
            }
        }
        return rowOutput.join(this.separator);
    }
    outputRowsForSale(row, columns, sale) {
        let output = this.outputRowForSale(row, columns, sale);
        if (output !== null) {
            return [output];
        }
        else {
            return [];
        }
    }
    outputRowForSale(row, columns, sale, filter) {
        const dataValues = {};
        let count = 0;
        if (row.type.id === "line_items_each") {
            let outputRows = [];
            for (let index in sale.summary.line_items) {
                let lineItem = sale.summary.line_items[index];
                const amountProperties = ["base_price", "retail_price", "sales_tax_amount", "sub_total", "total", "total_tax_amount", "vat_amount"];
                const valueProperties = ["barcode", "id", "image_url", "quantity", "variant_id"];
                const localizedProperties = ["name", "variant_name"];
                const discountAmount = numeral_1.default(0).add(lineItem["retail_price"] || 0).subtract(lineItem["sub_total"] || 0);
                dataValues["discount_amount"] = `"${this.formatNumber(discountAmount.format('0.00'))}"`;
                for (const property of amountProperties) {
                    if (lineItem[property] !== null && lineItem[property] !== undefined) {
                        const amount = numeral_1.default(0).add(lineItem[property]);
                        const formatted = this.formatNumber(amount.format('0.00'));
                        dataValues[property] = `"${formatted}"`;
                    }
                }
                for (const property of valueProperties) {
                    if (lineItem[property] !== null && lineItem[property] !== undefined) {
                        dataValues[property] = `"${lineItem[property]}"`;
                    }
                }
                for (const property of localizedProperties) {
                    if (lineItem[property] !== null && lineItem[property] !== undefined) {
                        dataValues[property] = `"${localize(lineItem[property], "da")}"`;
                    }
                }
                const type = (sale.voided || false) ? "void" : ((sale.summary.is_return || false) ? "return" : "sale");
                dataValues["type"] = type;
                dataValues["sale_id"] = sale.identifier;
                dataValues["sequence_number"] = sale.sequence_number;
                dataValues["timestamp"] = sale.timing.timestamp_string;
                dataValues["timezone"] = sale.timing.timezone;
                const sourceProperties = ["cashier_id", "cashier_name", "register_id", "register_name", "market_id", "market_name", "shop_id", "shop_name"];
                for (const property of sourceProperties) {
                    if (sale.source[property] !== null) {
                        dataValues[property] = `"${sale.source[property]}"`;
                    }
                }
                outputRows.push(this.outputRowShared(row, columns, sale, this.removeNewLines(dataValues), 1));
            }
            return outputRows.join("\n");
        }
        return this.outputRowShared(row, columns, sale, dataValues, count);
    }
    export() {
        let output = [];
        const headers = this.outputHeaders(this.configuration.columns);
        output.push(headers);
        for (const element of this.elements) {
            for (const row of this.configuration.rows) {
                const rows = this.outputRows(row, this.configuration.columns, element);
                output = output.concat(rows);
            }
        }
        return output.join("\n");
    }
}
exports.CSVExport = CSVExport;

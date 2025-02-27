"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CSVExport = void 0;
const _ = require("lodash");
const numeral = require("numeral");
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
        this.itemType = configuration.configuration.item_type || "sale";
        this.separator = configuration.configuration.csv_separator || ";";
        this.delimiter = configuration.configuration.decimal_separator || ",";
    }
    escape(value) {
        return value.replace(new RegExp(this.separator, "g"), "\\" + this.separator);
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
        const headers = [];
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
        const output = this.outputRowForRegisterStatement(row, columns, statement);
        if (output !== null) {
            return [output];
        }
        else {
            return [];
        }
    }
    outputRowForRegisterStatement(row, columns, statement) {
        const overrides = {};
        const count = 0;
        return this.outputRowShared(row, columns, statement, overrides, count);
    }
    outputRowShared(row, columns, element, dataValues, count) {
        if (count === 0) {
            return null;
        }
        const values = {};
        for (const key in row.values) {
            values[key] = row.values[key];
        }
        for (const key in dataValues) {
            values[key] = dataValues[key];
        }
        if (row.required_values) {
            let requirementsMet = true;
            for (const index in row.required_values) {
                const required = row.required_values[index];
                if (typeof values[required] === "undefined") {
                    requirementsMet = false;
                }
            }
            if (!requirementsMet) {
                return null;
            }
        }
        const rowOutput = [];
        for (const index in columns) {
            const column = columns[index];
            if (column.value) {
                const val = (typeof values[column.value] !== "undefined") ? values[column.value] : "";
                rowOutput.push(val);
            }
            else {
                rowOutput.push("");
            }
        }
        return rowOutput.join(this.separator);
    }
    outputRowsForSale(row, columns, sale) {
        const output = this.outputRowForSale(row, columns, sale);
        if (output !== null) {
            return [output];
        }
        else {
            return [];
        }
    }
    typeForSale(sale) {
        if (sale.voided || false) {
            return "void";
        }
        else if (!_.isNil(sale.summary.return_reference)) {
            return "return";
        }
        else if (!_.isNil(sale.summary.expense_reference)) {
            return "expense";
        }
        else {
            return "sale";
        }
    }
    outputRowForSale(row, columns, sale, filter) {
        var _a;
        const dataValues = {};
        const count = 0;
        if (row.type.id === "line_items_each") {
            const outputRows = [];
            for (const index in sale.summary.line_items) {
                const lineItem = sale.summary.line_items[index];
                const amountProperties = ["base_price", "retail_price", "sales_tax_amount", "sub_total", "total", "total_tax_amount", "vat_amount", "cost_price", "margin", "margin_total"];
                const valueProperties = ["barcode", "id", "image_url", "quantity", "variant_id", "product_group"];
                const localizedProperties = ["name", "variant_name"];
                const discountAmount = numeral(0).add(lineItem["retail_price"] || 0).subtract(lineItem["sub_total"] || 0);
                dataValues["discount_amount"] = `"${this.formatNumber(discountAmount.format("0.00"))}"`;
                for (const property of amountProperties) {
                    delete dataValues[property];
                    if (lineItem[property] !== null && lineItem[property] !== undefined) {
                        const amount = numeral(0).add(lineItem[property]);
                        const formatted = this.formatNumber(amount.format("0.00"));
                        dataValues[property] = `"${formatted}"`;
                    }
                }
                for (const property of valueProperties) {
                    delete dataValues[property];
                    if (lineItem[property] !== null && lineItem[property] !== undefined) {
                        dataValues[property] = `"${lineItem[property]}"`;
                    }
                }
                for (const property of localizedProperties) {
                    delete dataValues[property];
                    if (lineItem[property] !== null && lineItem[property] !== undefined) {
                        dataValues[property] = `"${localize(lineItem[property], "da")}"`;
                    }
                }
                const type = this.typeForSale(sale);
                dataValues["type"] = type;
                dataValues["sale_id"] = sale.identifier;
                dataValues["sequence_number"] = sale.sequence_number;
                dataValues["timestamp"] = sale.timing.timestamp_string;
                dataValues["timezone"] = sale.timing.timezone;
                let externallyPaid = "";
                for (const payment of (_a = sale.payments) !== null && _a !== void 0 ? _a : []) {
                    if (payment.payment_type === "externally_paid") {
                        externallyPaid = "true";
                    }
                }
                dataValues["externally_paid"] = externallyPaid;
                const sourceProperties = ["cashier_id", "cashier_name", "register_id", "register_name", "market_id", "market_name", "shop_id", "shop_name"];
                for (const property of sourceProperties) {
                    delete dataValues[property];
                    if (sale.source[property] !== null) {
                        dataValues[property] = `"${sale.source[property]}"`;
                    }
                }
                if (!_.isNil(sale.summary.customer)) {
                    if (!_.isNil(sale.summary.customer.identifier)) {
                        dataValues["customer_id"] = sale.summary.customer.identifier;
                    }
                    if (!_.isNil(sale.summary.customer.organization_number)) {
                        dataValues["organization_number"] = sale.summary.customer.organization_number;
                        this.setInfoOnB2BCustomer(sale, dataValues);
                    }
                }
                this.removeNewLines(dataValues);
                const o = this.outputRowShared(row, columns, sale, dataValues, 1);
                if (o) {
                    outputRows.push(o);
                }
            }
            return outputRows.join("\n");
        }
        return this.outputRowShared(row, columns, sale, dataValues, count);
    }
    setInfoOnB2BCustomer(sale, dataValues) {
        if (!_.isNil(sale.summary.customer.address)) {
            if (!_.isNil(sale.summary.customer.address.name)) {
                dataValues["customer_name"] = sale.summary.customer.address.name;
            }
            if (!_.isNil(sale.summary.customer.address.street)) {
                dataValues["street"] = sale.summary.customer.address.street;
            }
            if (!_.isNil(sale.summary.customer.address.city)) {
                dataValues["city"] = sale.summary.customer.address.city;
            }
            if (!_.isNil(sale.summary.customer.address.postal_code)) {
                dataValues["postal_code"] = sale.summary.customer.address.postal_code;
            }
        }
        if (!_.isNil(sale.summary.customer.customer_info)) {
            if (!_.isNil(sale.summary.customer.customer_info.phone)) {
                dataValues["phone"] = sale.summary.customer.customer_info.phone;
            }
            if (!_.isNil(sale.summary.customer.customer_info.email)) {
                dataValues["email"] = sale.summary.customer.customer_info.email;
            }
        }
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
//# sourceMappingURL=CSVExport.js.map
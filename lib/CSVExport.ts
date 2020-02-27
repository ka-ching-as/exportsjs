import * as _ from "lodash"
import * as numeral from "numeral"

function localize(l10nString: any, language: string) {
    if (!l10nString) { return "" }
    if (typeof (l10nString) !== "object") {
        return l10nString
    }
    return l10nString[language] || l10nString["en"] || l10nString[Object.keys(l10nString)[0]]
}

export class CSVExport {
    elements: any
    configuration: any
    itemType: string
    separator: string
    delimiter: string

    constructor(configuration: any, elementDict: any) {
        this.elements = Object.keys(elementDict).map(function(key) {
            return elementDict[key]
        })
        this.configuration = configuration
        this.itemType = configuration.configuration.item_type || "sale"

        this.separator = configuration.configuration.csv_separator || ";"
        this.delimiter = configuration.configuration.decimal_separator || ","
    }

    private escape(value: string): string {
        return value.replace(new RegExp(this.separator, "g"), "\\" + this.separator)
    }

    private formatNumber(value: string): string {
        return value.replace(/\./g, this.delimiter)
    }

    private removeNewLines(dataValues: any) {
        for (const key in dataValues) {
            const element = dataValues[key]
            if (typeof element === "string") {
                dataValues[key] = element.replace(/(\r\n|\n|\r)/gm, " ")
            }
        }
    }

    private outputHeaders(columns: any[]): string {
        const headers: string[] = []
        for (const column of columns) {
            headers.push(this.escape(column.header))
        }
        return headers.join(this.separator)
    }

    private outputRows(row: any, columns: any, element: any): string[] {
        if (this.itemType === "sale") {
            return this.outputRowsForSale(row, columns, element)
        } else if (this.itemType === "register_statement") {
            return this.outputRowsForRegisterStatement(row, columns, element)
        } else {
            return []
        }
    }

    private outputRowsForRegisterStatement(row: any, columns: any, statement: any): string[] {
        const output = this.outputRowForRegisterStatement(row, columns, statement)
        if (output !== null) {
            return [output]
        } else {
            return []
        }
    }

    private outputRowForRegisterStatement(row: any, columns: any, statement: any): string | null {
        const overrides: any = {}
        const count = 0
        return this.outputRowShared(row, columns, statement, overrides, count)
    }

    private outputRowShared(row: any, columns: any, element: any, dataValues: any, count: number): string | null {
        if (count === 0) { return null }
        const values: any = {}
        for (const key in row.values) {
            values[key] = row.values[key]
        }
        for (const key in dataValues) {
            values[key] = dataValues[key]
        }

        if (row.required_values) {
            let requirementsMet = true
            for (const index in row.required_values) {
                const required = row.required_values[index]
                if (typeof values[required] === "undefined") {
                    requirementsMet = false
                }
            }
            if (!requirementsMet) {
                return null
            }
        }

        const rowOutput: any[] = []
        for (const index in columns) {
            const column = columns[index]
            if (column.value) {
                const val = (typeof values[column.value] !== "undefined") ? values[column.value] : ""
                rowOutput.push(val)
            } else {
                rowOutput.push("")
            }
        }
        return rowOutput.join(this.separator)
    }

    private outputRowsForSale(row: any, columns: any, sale: any): string[] {
        const output = this.outputRowForSale(row, columns, sale)
        if (output !== null) {
            return [output]
        } else {
            return []
        }
    }

    private typeForSale(sale: any): string {
        if (sale.voided || false) {
            return "void"
        } else if (!_.isNil(sale.summary.return_reference)) {
            return "return"
        } else if (!_.isNil(sale.summary.expense_reference)) {
            return "expense"
        } else {
            // We also have sales from sales quotes and sales from external orders
            // but these are still essentially sales, so in order to not mess with
            // the expectations of the receiver, these are all represented as 'sale'
            return "sale"
        }
    }

    private outputRowForSale(row: any, columns: any, sale: any, filter?: any): string | null {
        const dataValues: any = {}
        const count = 0
        if (row.type.id === "line_items_each") {
            const outputRows: string[] = []
            for (const index in sale.summary.line_items) {
                const lineItem = sale.summary.line_items[index]
                const amountProperties = ["base_price", "retail_price", "sales_tax_amount", "sub_total", "total", "total_tax_amount", "vat_amount"]
                const valueProperties = ["barcode", "id", "image_url", "quantity", "variant_id", "product_group"]
                const localizedProperties = ["name", "variant_name"]

                const discountAmount = numeral(0).add(lineItem["retail_price"] || 0).subtract(lineItem["sub_total"] || 0)
                dataValues["discount_amount"] = `"${this.formatNumber(discountAmount.format("0.00"))}"`

                for (const property of amountProperties) {
                    if (lineItem[property] !== null && lineItem[property] !== undefined) {
                        const amount = numeral(0).add(lineItem[property])
                        const formatted = this.formatNumber(amount.format("0.00"))
                        dataValues[property] = `"${formatted}"`
                    }
                }
                for (const property of valueProperties) {
                    if (lineItem[property] !== null && lineItem[property] !== undefined) {
                        dataValues[property] = `"${lineItem[property]}"`
                    }
                }

                for (const property of localizedProperties) {
                    if (lineItem[property] !== null && lineItem[property] !== undefined) {
                        dataValues[property] = `"${localize(lineItem[property], "da")}"`
                    }
                }
                const type = this.typeForSale(sale)
                dataValues["type"] = type
                dataValues["sale_id"] = sale.identifier
                dataValues["sequence_number"] = sale.sequence_number
                dataValues["timestamp"] = sale.timing.timestamp_string
                dataValues["timezone"] = sale.timing.timezone
    
                const sourceProperties = ["cashier_id", "cashier_name", "register_id", "register_name", "market_id", "market_name", "shop_id", "shop_name"]
                for (const property of sourceProperties) {
                    if (sale.source[property] !== null) {
                        dataValues[property] = `"${sale.source[property]}"`
                    }
                }

                if (!_.isNil(sale.summary.customer) && !_.isNil(sale.summary.customer.identifier)) {
                    dataValues["customer_id"] = sale.summary.customer.identifier
                }

                this.removeNewLines(dataValues)
                const o = this.outputRowShared(row, columns, sale, dataValues, 1)
                if (o) {
                    outputRows.push(o)
                }
            }
            return outputRows.join("\n")
        }
        return this.outputRowShared(row, columns, sale, dataValues, count)
    }

    export(): string {
        let output: string[] = []
        const headers = this.outputHeaders(this.configuration.columns)
        output.push(headers)
        for (const element of this.elements) {
            for (const row of this.configuration.rows) {
                const rows = this.outputRows(row, this.configuration.columns, element)
                output = output.concat(rows)
            }
        }
        return output.join("\n")
    }
}

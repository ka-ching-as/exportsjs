import numeral from "numeral"
import moment from "moment"

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
        this.itemType = configuration.configuration.item_type || 'sale'

        this.separator = configuration.configuration.csv_separator || ','
        this.delimiter = configuration.configuration.decimal_separator || '.'
    }

    escape(value: string): string {
        return value.replace(new RegExp(this.separator, 'g'), "\\" + this.separator)
    }

    formatNumber(value: string): string {
        return value.replace(/\./g, this.delimiter)
    }

    outputHeaders(columns: any[]): string {
        let headers = []
        for (const column of columns) {
            headers.push(this.escape(column.header))
        }
        return headers.join(this.separator)
    }

    resolve(object: any, keypath: string) {
        return keypath.split('.').reduce((o, i) => { if (o) { return o[i] } else { return "undefined" } }, object)
    }

    parametrizeString(string: string, object: any): string {
        let replaced = string.replace(/({.*?})/g, j => {
            var removedBraces = j.substr(1).slice(0, -1)
            let components = removedBraces.split('|')
            var path = components[0]
            var value = this.resolve(object, path)
            if (typeof value === 'undefined') {
                if (components.length > 1) {
                    return components[1]
                }
                return "XXX_ERROR_XXX"
            }
            if (value.constructor === Number) {
                const ski = numeral(value)
                return numeral(value).value()
            } else {
                return value
            }
        })
        if (replaced.includes('XXX_ERROR_XXX')) {
            return ""
        }
        return replaced
    }

    evaluate(expression: string, object: any): string {
        return this.parametrizeString(expression, object)
    }

    outputRows(row: any, columns: any, element: any): string[] {
        if (this.itemType === "sale") {
            return this.outputRowsForSale(row, columns, element)
        } else if (this.itemType === "register_statement") {
            return this.outputRowsForRegisterStatement(row, columns, element)
        } else {
            return []
        }
    }

    outputRowsForRegisterStatement(row: any, columns: any, statement: any): string[] {
        let output = this.outputRowForRegisterStatement(row, columns, statement)
        // console.log(output)
        if (output !== null) {
            return [output]
        } else {
            return []
        }
    }

    outputRowForRegisterStatement(row: any, columns: any, statement: any): string | null {
        const aggregates: any = {}
        const overrides: any = {}
        var count = 0
        if (row.type.id === "total_by_tax") {
            let rate = row.type.rate
            let total_type = row.type.total_type || "all"
            const totals = statement.register_summary[total_type]

            if (rate === 0) {
                const total = numeral(totals.total)
                for (let index in statement.register_summary[total_type].tax_summaries) {
                    let tax = statement.register_summary[total_type].tax_summaries[index]
                    if (tax.rate === 0) { continue }
                    const factor = numeral(1).add(tax.rate).divide(tax.rate)
                    const result = factor.multiply(tax.amount)
                    total.subtract(result.value())
                }
                if (total.value() > 0.00001) {
                    for (let aggregate in row.aggregates) {
                        aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(total.value())
                    }
                    count++
                }
            } else {
                for (let index in statement.register_summary[total_type].tax_summaries) {
                    let tax = statement.register_summary[total_type].tax_summaries[index]
                    if (tax.rate !== rate) { continue }
                    for (let aggregate in row.aggregates) {
                        let expression = row.aggregates[aggregate]
                        let value = this.evaluate(expression, tax)
                        if (typeof value === 'undefined') { continue }
                        const factor = numeral(1).add(rate).divide(rate)
                        const result = factor.multiply(value)
                        aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(result.value())
                    }
                    count++
                }
            }
        }
        else if (row.type.id === "cost_price") {
            let total_type = row.type.total_type || "all"
            const totals = statement.register_summary[total_type]
            if (totals.margin && totals.margin_total) {
                const modifiedTotals = JSON.parse(JSON.stringify(totals))
                modifiedTotals["cost_price"] = totals.margin_total - totals.margin
                for (let aggregate in row.aggregates) {
                    let expression = row.aggregates[aggregate]
                    let value = this.evaluate(expression, modifiedTotals)
                    if (typeof value === 'undefined') { continue }
                    aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(value)
                }
                count++
            }
        }
        else if (row.type.id === "total_by_paymenttype") {
            let total_type = row.type.total_type || "all"
            const totals = statement.register_summary[total_type]
            for (const paymentIndex in totals.payments) {
                const payment = totals.payments[paymentIndex]
                if (payment.type === row.type.payment_type) {
                    for (let aggregate in row.aggregates) {
                        let expression = row.aggregates[aggregate]
                        let value = this.evaluate(expression, payment.totals)
                        if (typeof value === 'undefined') { continue }
                        aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(value)
                    }
                    count++
                }
            }
        }
        else if (row.type.id === "total_by_paymenttype_other") {
            let total_type = row.type.total_type || "all"
            const totals = statement.register_summary[total_type]
            for (const paymentIndex in totals.payments) {
                const payment = totals.payments[paymentIndex]
                const exclude = row.type.exclude
                if (!exclude.includes(payment.type)) {
                    for (let aggregate in row.aggregates) {
                        let expression = row.aggregates[aggregate]
                        let value = this.evaluate(expression, payment.totals)
                        if (typeof value === 'undefined') { continue }
                        aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(value)
                    }
                    count++
                }
            }
        }
        else if (row.type.id === "difference_by_paymenttype") {
            for (const reconciliationIndex in statement.reconciliations) {
                const reconciliation = statement.reconciliations[reconciliationIndex]
                let paymentType = reconciliation.payment_type_identifier
                if (typeof paymentType === "object") {
                    paymentType = paymentType.id
                }
                if (paymentType === row.type.payment_type) {
                    const reconciliationCopy = JSON.parse(JSON.stringify(reconciliation))
                    // Positive means that the store has too much
                    reconciliationCopy.difference = reconciliation.counted - reconciliation.total
                    for (let aggregate in row.aggregates) {
                        let expression = row.aggregates[aggregate]
                        let value = this.evaluate(expression, reconciliationCopy)
                        if (typeof value === 'undefined') { continue }
                        aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(value)
                    }
                    count++
                }
            }
        }
        return this.outputRowShared(row, columns, statement, aggregates, overrides, count)
    }

    outputRowShared(row: any, columns: any, element: any, aggregates: any, overrides: any, count: number): string | null {
        if (count === 0) { return null }
        let values: any = {}
        for (const key in row.values) {
            values[key] = row.values[key]
        }
        for (const key in aggregates) {
            values[key] = this.formatNumber(aggregates[key].format('0.00'))
        }
        for (const key in overrides) {
            values[key] = overrides[key]
        }

        if (row.required_values) {
            var requirementsMet = true
            for (let index in row.required_values) {
                let required = row.required_values[index]
                if (typeof values[required] === 'undefined') {
                    requirementsMet = false
                }
            }
            if (!requirementsMet) {
                return null
            }
        }

        var rowOutput = []
        for (let index in columns) {
            let column = columns[index]
            if (column.value) {
                let val = (typeof values[column.value] !== 'undefined') ? values[column.value] : ""
                rowOutput.push(val)
            } else if (column.date) {
                let format = column.format || "YYYY"
                let inputFormat = column.input_format || moment.ISO_8601
                rowOutput.push(moment(this.resolve(element, column.date), inputFormat).format(format))
            } else if (column.string) {
                rowOutput.push(column.string)
            } else {
                rowOutput.push("")
            }
        }
        return rowOutput.join(this.separator)
    }

    outputRowsForSale(row: any, columns: any, sale: any): string[] {
        if (row.type.id === "payments_by_type_and_currency") {
            var currencies = new Set([sale.base_currency_code || 'DKK'])
            for (let index in sale.payments) {
                let type = row.type.type
                let payment = sale.payments[index]
                if (payment.payment_type === 'cash.rounding') {
                    payment.payment_type = "rounding"
                }
                if (!payment.success) { continue }
                if (payment.payment_type.split(".")[0] !== type) { continue }
                if (payment.foreign_currency) {
                    currencies.add(payment.foreign_currency)
                }
            }
            const rows: any[] = []
            currencies.forEach(currency => {
                let output = this.outputRowForSale(row, columns, sale, currency)
                if (output !== null) {
                    rows.push(output)
                }
            })
            return rows
        } else {
            let output = this.outputRowForSale(row, columns, sale)
            // console.log(output)
            if (output !== null) {
                return [output]
            } else {
                return []
            }
        }
    }

    outputRowForSale(row: any, columns: any, sale: any, filter?: any): string | null {
        const aggregates: any = {}
        const overrides: any = {}
        let count = 0
        if (row.type.id === "payments_by_type_and_currency") {
            for (let index in sale.payments) {
                let type = row.type.type
                var payment = sale.payments[index]
                if (payment.foreign_currency) {
                    payment.base_currency_amount = 0
                } else {
                    payment.base_currency_amount = payment.amount
                }
                if (!payment.success) { continue }
                if (payment.payment_type.split(".")[0] !== type) { continue }
                let currency = payment.foreign_currency || sale.base_currency_code || 'DKK'
                if (currency !== filter) {
                    continue
                }
                overrides["currency"] = currency
                for (let aggregate in row.aggregates) {
                    let expression = row.aggregates[aggregate]
                    let value = this.evaluate(expression, payment)
                    if (typeof value === 'undefined') { continue }
                    aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(value)
                }
                count++
            }
        } else if (row.type.id === "payments_by_type") {
            for (let index in sale.payments) {
                let type = row.type.type
                let payment = sale.payments[index]
                if (!payment.success) { continue }
                if (payment.payment_type.split(".")[0] !== type) { continue }
                for (let aggregate in row.aggregates) {
                    let expression = row.aggregates[aggregate]
                    let value = this.evaluate(expression, payment)
                    if (typeof value === 'undefined') { continue }
                    aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(value)
                }
                count++
            }
        } else if (row.type.id === "line_items") {
            for (let index in sale.summary.line_items) {
                let lineItem = sale.summary.line_items[index]
                for (let aggregate in row.aggregates) {
                    let expression = row.aggregates[aggregate]
                    let value = this.evaluate(expression, lineItem)
                    if (typeof value === 'undefined') { continue }
                    aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(value)
                }
                count++
            }
        } else if (row.type.id === "line_items_each") {
            let outputRows = []
            for (let index in sale.summary.line_items) {
                let lineItem = sale.summary.line_items[index]
                const amountProperties = ["base_price", "retail_price", "sales_tax_amount", "sub_total", "total", "total_tax_amount", "vat_amount"]
                const valueProperties = ["barcode", "id", "image_url", "quantity", "variant_id"]
                const localizedProperties = ["name", "variant_name"]

                // BG: Hotfix 5.0.4 
                // I'm putting the amounts into the overrides dict instead of the aggregates dict so I can control formatting here.
                // It's necessary because we need to wrap all the values in "" since we use comma for both field separator and decimal separator 
                // in the CSV sales lines export. We experienced both product names and amounts containing commas which would mess up the resulting file.
                // TODO: Consider if we should use ; as field separator instead? I still think we would need to wrap in "" though because of freetext and localized amounts.

                const discountAmount = numeral(0).add(lineItem["retail_price"] || 0).subtract(lineItem["sub_total"] || 0);
                overrides["discount_amount"] = `"${this.formatNumber(discountAmount.format('0.00'))}"`

                for (const property of amountProperties) {
                    if (lineItem[property] !== null && lineItem[property] !== undefined) {
                        const amount = numeral(0).add(lineItem[property]);
                        const formatted = this.formatNumber(amount.format('0.00'))
                        overrides[property] = `"${formatted}"`
                    }
                }
                for (const property of valueProperties) {
                    if (lineItem[property] !== null && lineItem[property] !== undefined) {
                        overrides[property] = `"${lineItem[property]}"`
                    }
                }

                for (const property of localizedProperties) {
                    if (lineItem[property] !== null && lineItem[property] !== undefined) {
                        overrides[property] = `"${localize(lineItem[property], "da")}"`
                    }
                }
                const type = (sale.voided || false) ? "void" : ((sale.summary.is_return || false) ? "return" : "sale")
                overrides["type"] = type
                overrides["sale_id"] = sale.identifier
                overrides["sequence_number"] = sale.sequence_number
                overrides["timestamp"] = sale.timing.timestamp_string
                overrides["timezone"] = sale.timing.timezone
    
                const sourceProperties = ["cashier_id", "cashier_name", "register_id", "register_name", "market_id", "market_name", "shop_id", "shop_name"]
                for (const property of sourceProperties) {
                    if (sale.source[property] !== null) {
                        overrides[property] = sale.source[property]
                    }
                }
                outputRows.push(this.outputRowShared(row, columns, sale, aggregates, overrides, 1))
            }

            return outputRows.join("\n")
        } else if (row.type.id === "line_items_by_tax") {
            let rate = row.type.rate
            for (let index in sale.summary.line_items) {
                let lineItem = sale.summary.line_items[index]
                if (!lineItem.taxes || lineItem.taxes.length !== 1 || lineItem.taxes[0].rate !== rate) { continue }
                for (let aggregate in row.aggregates) {
                    let expression = row.aggregates[aggregate]
                    let value = this.evaluate(expression, lineItem)
                    if (typeof value === 'undefined') { continue }
                    aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(value)
                }
                count++
            }
        } else if (row.type.id === "total") {
            for (let aggregate in row.aggregates) {
                let expression = row.aggregates[aggregate]
                let value = this.evaluate(expression, sale.summary)
                if (typeof value === 'undefined') { continue }
                aggregates[aggregate] = (aggregates[aggregate] || numeral(0)).add(value)
            }
            count++
        }
        return this.outputRowShared(row, columns, sale, aggregates, overrides, count)
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

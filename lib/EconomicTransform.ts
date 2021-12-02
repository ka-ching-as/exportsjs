import * as _ from "lodash"
import { SkipExport } from "./SkipExport"
import * as moment from "moment-timezone"

interface Account {
    account: number,
    description: string
}

function lookupYear(years: any, date: string): string {
    for (const entry of years) {
        if (date >= entry.from_date && date <= entry.to_date) {
            return entry.year
        }
    }
    throw new Error("Fiscal year not found for date: " + date)
}

function paymentTypeKey(paymentType: string): string {
    if (paymentType === "cash.cashback") {
        return "cash"
    }
    return paymentType.replace(".", "-")
}

function sourceDescription(source: any): string {
    const shopName = source.shop_name
    const registerName = source.register_name
    const cashierInitials = source.cashier_name
    return ` - ${shopName}, ${registerName}, ${cashierInitials}`
}

export class EconomicTransform {
    data: any
    configuration: any

    constructor(configuration: any, data: any) {
        this.data = data
        this.configuration = configuration
    }

    lookupVatCode(rate: number, type: string, isIncoming: boolean = false): string | undefined {
        for (const tax of this.configuration.tax_codes) {
            if (tax.rate === rate && tax.type === type) {
                if (isIncoming && tax.incoming !== true) { continue }
                return tax.code
            }
        }
        return undefined
    }

    accountLookup(paymentType: string, cardType?: string): Account {
        const key = paymentTypeKey(paymentType)
        if (cardType !== undefined) {
            const cardSpecificKey = `${key}-${cardType}`
            const cardSpecificAccount = this.configuration.account_map.payments[cardSpecificKey]
            if (!_.isNil(cardSpecificAccount)) {
                return cardSpecificAccount
            }
        }
        const account = this.configuration.account_map.payments[key]
        if (!_.isNil(account)) {
            if (cardType !== undefined) {
                const clone = _.cloneDeep(account)
                clone.description = (account.description ?? "") + ` (${cardType})`
                return clone
            }
            return account
        }
        const fallback = this.configuration.account_map.general.fallback
        return {
            description: fallback.description + " " + paymentType,
            account: fallback.account
        }
    }

    accountDiffLookup(paymentType: string, comment: string): Account {
        const key = paymentTypeKey(paymentType)
        const account = this.configuration.account_map.diffs[key]
        if (!_.isNil(account)) {
            return {
                account: account.account,
                description: account.description + ": " + comment
            }
        }
        const fallback = this.configuration.account_map.general.fallback
        return {
            description: fallback.description + ": " + comment + " " + paymentType,
            account: fallback.account
        }
    }

    accountDepositLookup(paymentType: string): Account {
        const key = paymentTypeKey(paymentType)
        const account = this.configuration.account_map.deposits[key]
        if (!_.isNil(account)) {
            return account
        }
        const fallback = this.configuration.account_map.general.fallback
        return {
            description: fallback.description + " " + paymentType,
            account: fallback.account
        }
    }

    localize(input: any, language: string | undefined): string {
        const useLanguage = language ?? "da"
        if (typeof (input) === "string") {
            return input
        } else if (typeof (input) === "object") {
            if (!_.isNil(input[useLanguage])) {
                return input[useLanguage]
            } else if (!_.isNil(input["en"])) {
                return input["en"]
            } else if (Object.keys(input).length > 0) {
                return input[Object.keys(input)[0]]
            }
        }
        return "-"
    }

    outgoingOrderExport(): any {
        const order = this.data
        const parameters = this.configuration
        if (parameters.type !== "intercompany_invoicing") {
            console.warn("Only 'intercompany_invoicing' order export is currently supported")
            throw new SkipExport("Only 'intercompany_invoicing' order export is currently supported")
        }

        const destinationId = order.order.destination_identifier
        // use the destination as the filter, since the destination is the place where the invoice should be sent from
        if (typeof (parameters.filters) === "object" &&
            typeof (parameters.filters.shops) === "object" &&
            (_.isNil(parameters.filters.shops[destinationId]) ||
                parameters.filters.shops[destinationId] === false
            )) {
            console.info(`Skipping outgoing order export for destination: ${destinationId} since it's not in the shops filter list`)
            throw new SkipExport(`Skipping outgoing order export for destination: ${destinationId} since it's not in the shops filter list`)
        }
        const source = order.order.source_identifier

        let departmentalDistribution: any = undefined
        if (typeof (parameters.shop_map) === "object" && parameters.shop_map[destinationId]) {
            const department = parseInt(parameters.shop_map[destinationId])
            departmentalDistribution = {
                departmentalDistributionNumber: department,
                type: "department"
            }
        }
        const customerData = (parameters.customer_map ?? {})[source]
        const layout = parameters.layout ?? {}
        const language = parameters.language ?? undefined
        const timezone = parameters.timezone ?? "Europe/Copenhagen"
        const paymentTerms = parameters.payment_terms ?? {}
        const productMap = parameters.product_map ?? {}
        let costPriceTotal = 0
        const lines: any[] = []
        let lineNumber = 1
        for (const item of order.order.basket.line_items) {
            if (!_.isNil(item.behavior) ||
                _.isNil(item.id) ||
                _.isNil(item.cost_price) ||
                _.isNil(item.quantity) ||
                item.quantity === 0) {
                // Skipping behavior line items or items with unknown product ids
                continue
            }
            costPriceTotal += item.cost_price

            let template: string
            if (!_.isNil(item.variant_id)) {
                template = productMap.variant ?? ""
            } else {
                template = productMap.product ?? ""
            }
            const productNumber = template.replace(/\{\{([^\}]+)\}\}/g, (match, group) => {
                if (!_.isNil(item[group])) {
                    return `${item[group]}`
                } else {
                    return ""
                }
            })

            const line = {
                lineNumber: lineNumber,
                product: {
                    productNumber: productNumber
                },
                description: this.localize(item.name, language),
                quantity: item.quantity,
                unitNetPrice: item.cost_price / item.quantity
            }

            lines.push(line)

            lineNumber += 1
        }
        if (lines.length === 0) {
            throw new SkipExport("No invoiceable line items")
        }
        const timestamp = moment(order.state.created * 1000).tz(timezone)
        const date = timestamp.format("YYYY-MM-DD")
        const invoice: any = {
            date: date,
            currency: order.order.currency,
            netAmount: costPriceTotal,
            vatAmount: 0,
            paymentTerms: paymentTerms,
            customer: customerData.customer,
            recipient: customerData.recipient,
            references: {
                other: order.order.order_identifier
            },
            layout: layout,
            lines: lines
        }
        return invoice
    }

    saleExport(): any {
        const sale = this.data
        const parameters = this.configuration
        const shopId = sale.source.shop_id

        if (typeof (parameters.filter) === "object" &&
            typeof (parameters.filter.shops) === "object" &&
            (_.isNil(parameters.filter.shops[shopId]) ||
                parameters.filter.shops[shopId] === false
            )) {
            console.info(`Skipping sales export for shop: ${shopId} since it's not in the shops filter list`)
            return
        }

        const skipDescription = parameters.skip_description ?? false

        const summary = sale.summary
        if (!summary) {
            throw new Error("Cannot find a sales summary")
        }
        if (sale.voided) {
            throw new SkipExport("Voided sale")
        }
        const isReturn = summary.is_return || false
        const isExpense = !_.isNil(summary.expense_reference)

        const dateString: string = sale.timing.timestamp_date_string
        const comps = dateString.split("-")
        const date = `${comps[0]}-${comps[1]}-${comps[2]}`
        const yearString = lookupYear(parameters.fiscal_years, date)

        const journalEntry: any = {}
        journalEntry.accountingYear = { year: yearString }
        journalEntry.journal = { journalNumber: parameters.journal_number }
        const vouchers: any[] = []
        let saleAccount = parameters.account_map.general.sale
        if (isReturn && !_.isNil(parameters.account_map.general.return)) {
            saleAccount = parameters.account_map.general.return
        } else if (isExpense) {
            // Use an expense account config if present - otherwise fall back to return 
            // (as an expense is more similar to a return than a sale)
            if (!_.isNil(parameters.account_map.general.expense)) {
                saleAccount = parameters.account_map.general.expense
            } else if (!_.isNil(parameters.account_map.general.return)) {
                saleAccount = parameters.account_map.general.return
            }
        }

        const sourceDesc = skipDescription ? "" : sourceDescription(sale.source) + " sale id: " + sale.identifier

        const taxTotals: any = {}

        let departmentalDistribution: any = undefined
        if (typeof (parameters.shop_map) === "object" && parameters.shop_map[shopId]) {
            const department = parseInt(parameters.shop_map[shopId])
            departmentalDistribution = {
                departmentalDistributionNumber: department,
                type: "department"
            }
        }

        for (const lineItem of sale.summary.line_items) {
            let taxes: any[] = lineItem.taxes
            if (!taxes) {
                taxes = [{ rate: 0, type: "vat" }]
            }
            if (taxes.length !== 1) {
                console.info("All line items must have exactly one tax entry in order to map to e-conomic journal vouchers", sale)
                continue
            }
            const tax = taxes[0]
            const rate = tax.rate
            const type = tax.type
            let key = `${type}-${rate}`
            if (isExpense) {
                const expenseCode = lineItem.behavior?.expense?.identifier ?? "-"
                key = `${expenseCode}-${type}-${rate}`
            }
            const existing = (taxTotals[key] ?? {}).total ?? 0
            taxTotals[key] = {
                total: existing + lineItem.total,
                rate: tax.rate,
                type: tax.type
            }
            if (isExpense) {
                const expenseCode = lineItem.behavior?.expense?.identifier ?? "-"
                taxTotals[key]["expense_code"] = expenseCode
            }
        }

        for (const key in taxTotals) {
            const totals = taxTotals[key]
            const vatCode = this.lookupVatCode(totals.rate, totals.type, isExpense)
            if (!_.isNil(totals.expense_code)) {
                if (!_.isNil(parameters.account_map.general[`expense-${totals.expense_code}`]))
                saleAccount = parameters.account_map.general[`expense-${totals.expense_code}`]
            }
            const voucher: any = {
                text: saleAccount.description + sourceDesc,
                amount: -totals.total,
                account: {
                    accountNumber: saleAccount.account
                },
                currency: {
                    code: sale.base_currency_code
                },
                date: date
            }
            if (!_.isNil(departmentalDistribution)) {
                voucher.departmentalDistribution = departmentalDistribution
            }
            if (!_.isNil(vatCode)) {
                voucher.vatAccount = {
                    vatCode: vatCode
                }
            }
            vouchers.push(voucher)
        }

        for (const payment of sale.payments) {
            if (!payment.success) {
                continue
            }
            let amount = payment.amount
            let currencyCode = sale.base_currency_code
            if (!_.isNil(payment.foreign_currency_amount)) {
                amount = payment.foreign_currency_amount
                currencyCode = payment.foreign_currency
            }
            const account = this.accountLookup(payment.payment_type, payment.metadata?.card_type)
            const voucher: any = {
                text: account.description + sourceDesc,
                amount: amount,
                account: {
                    accountNumber: account.account
                },
                currency: {
                    code: currencyCode
                },
                date: date
            }
            if (!_.isNil(departmentalDistribution)) {
                voucher.departmentalDistribution = departmentalDistribution
            }
            if (!_.isNil(payment.foreign_currency_amount)) {
                voucher.baseCurrencyAmount = payment.amount
                const exchangeRate = payment.amount * 100 / amount
                // Exchange rate must be rounded to 6 decimals
                voucher.exchangeRate = Math.round(exchangeRate * 1000000) / 1000000
            }
            vouchers.push(voucher)

        }
        journalEntry.entries = { financeVouchers: vouchers }

        return journalEntry
    }

    registerCloseStatementExport(): any {
        const statement = this.data
        const parameters = this.configuration
        const shopId = statement.source.shop_id
        const skipDescription = parameters.skip_description ?? false

        let date: string
        if (statement.timing) {
            const dateString: string = statement.timing.timestamp_date_string
            const comps = dateString.split("-")
            date = `${comps[0]}-${comps[1]}-${comps[2]}`
        } else {
            const timestampNumber = statement.reconciliation_time * 1000
            const timestamp = new Date(timestampNumber)
            date = timestamp.toISOString().split("T")[0]
        }

        const yearString = lookupYear(parameters.fiscal_years, date)

        const journalEntry: any = {}
        journalEntry.accountingYear = { year: yearString }
        journalEntry.journal = { journalNumber: parameters.journal_number }
        const vouchers: any[] = []
        const sourceDesc = skipDescription ? "" : sourceDescription(statement.source) + " statement number: " + statement.sequence_number

        let departmentalDistribution: any = undefined
        if (typeof (parameters.shop_map) === "object" && parameters.shop_map[shopId]) {
            const department = parseInt(parameters.shop_map[shopId])
            departmentalDistribution = {
                departmentalDistributionNumber: department,
                type: "department"
            }
        }

        if (!_.isNil(statement.register_summary.cash_diff_at_open)) {
            const diff = statement.register_summary.cash_diff_at_open
            const comment = statement.register_summary.cash_diff_comment_at_open
            const paymentTypeAccount = this.accountLookup("cash")
            const diffAccount = this.accountDiffLookup("cash", comment)
            const voucher1: any = {
                text: diffAccount.description + sourceDesc,
                amount: diff,
                account: {
                    accountNumber: paymentTypeAccount.account
                },
                currency: {
                    code: statement.base_currency_code
                },
                date: date
            }
            if (!_.isNil(departmentalDistribution)) {
                voucher1.departmentalDistribution = departmentalDistribution
            }
            vouchers.push(voucher1)
            const voucher2: any = {
                text: diffAccount.description + sourceDesc,
                amount: -diff,
                account: {
                    accountNumber: diffAccount.account
                },
                currency: {
                    code: statement.base_currency_code
                },
                date: date
            }
            if (!_.isNil(departmentalDistribution)) {
                voucher2.departmentalDistribution = departmentalDistribution
            }
            vouchers.push(voucher2)
        }

        for (const reconciliation of statement.reconciliations) {
            if (reconciliation.should_be_reconciled && !_.isNil(reconciliation.counted)) {
                const counted = reconciliation.counted
                const expected = reconciliation.total
                const diff = counted - expected
                if (diff !== 0) {
                    const comment = statement.comment || ""
                    const paymentType = reconciliation.payment_type_identifier
                    const paymentTypeAccount = this.accountLookup(paymentType)
                    const diffAccount = this.accountDiffLookup(paymentType, comment)
                    const voucher1: any = {
                        text: diffAccount.description + sourceDesc,
                        amount: diff,
                        account: {
                            accountNumber: paymentTypeAccount.account
                        },
                        currency: {
                            code: reconciliation.currency_code
                        },
                        date: date
                    }
                    if (!_.isNil(departmentalDistribution)) {
                        voucher1.departmentalDistribution = departmentalDistribution
                    }
                    vouchers.push(voucher1)
                    const voucher2: any = {
                        text: diffAccount.description + sourceDesc,
                        amount: -diff,
                        account: {
                            accountNumber: diffAccount.account
                        },
                        currency: {
                            code: reconciliation.currency_code
                        },
                        date: date
                    }
                    if (!_.isNil(departmentalDistribution)) {
                        voucher2.departmentalDistribution = departmentalDistribution
                    }
                    vouchers.push(voucher2)
                }
            }
            if (!_.isNil(reconciliation.deposited_amount)) {
                const deposited = reconciliation.deposited_amount
                const paymentType = reconciliation.payment_type_identifier
                const paymentTypeAccount = this.accountLookup(paymentType)
                const depositAccount = this.accountDepositLookup(paymentType)
                const voucher1: any = {
                    text: depositAccount.description + sourceDesc,
                    amount: -deposited,
                    account: {
                        accountNumber: paymentTypeAccount.account
                    },
                    currency: {
                        code: reconciliation.currency_code
                    },
                    date: date
                }
                if (!_.isNil(departmentalDistribution)) {
                    voucher1.departmentalDistribution = departmentalDistribution
                }
                vouchers.push(voucher1)
                const voucher2: any = {
                    text: depositAccount.description + sourceDesc,
                    amount: deposited,
                    account: {
                        accountNumber: depositAccount.account
                    },
                    currency: {
                        code: reconciliation.currency_code
                    },
                    date: date
                }
                if (!_.isNil(departmentalDistribution)) {
                    voucher2.departmentalDistribution = departmentalDistribution
                }
                vouchers.push(voucher2)
            }
        }
        journalEntry.entries = { financeVouchers: vouchers }

        return journalEntry
    }
}
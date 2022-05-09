import * as _ from "lodash"
import { SkipExport } from "./SkipExport"
import * as dayjs from "dayjs"
import * as utc from "dayjs/plugin/utc"
import * as dayjstimezone from "dayjs/plugin/timezone"

dayjs.extend(utc)
dayjs.extend(dayjstimezone)

interface Account {
    account: number,
    description: string
}

interface Config {
    skipZeroAmountTransactions: boolean,
    sourceDescription: string,
    departmentalDistribution?: any,
    currencyCode: string,
    date: string,
    differenceTaxCode: string | undefined
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

    accountDiffLookup(paymentType: string, comment: string, subType?: string): Account {
        const key = paymentTypeKey(paymentType)
        if (subType !== undefined) {
            const subTypeSpecificKey = `${key}-${subType}`
            const subTypeSpecificAccount = this.configuration.account_map.diffs[subTypeSpecificKey]
            if (!_.isNil(subTypeSpecificAccount)) {
                return subTypeSpecificAccount
            }
        }
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

    accountGenericLookup(type: "sale" | "return" | "expense", expenseCode?: string): Account {
        if (type === "return" && !_.isNil(this.configuration.account_map.general.return)) {
            return this.configuration.account_map.general.return
        } else if (type === "expense") {
            // Use an expense account config if present - otherwise fall back to return 
            // (as an expense is more similar to a return than a sale)
            if (!_.isNil(expenseCode)) {
                const key = `expense-${expenseCode}`
                if (!_.isNil(this.configuration.account_map.general[key])) {
                    return this.configuration.account_map.general[key]
                }
            }
            if (!_.isNil(this.configuration.account_map.general.expense)) {
                return this.configuration.account_map.general.expense
            } else if (!_.isNil(this.configuration.account_map.general.return)) {
                return this.configuration.account_map.general.return
            }
        }
        return this.configuration.account_map.general.sale
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
        const timestamp = dayjs(order.state.created * 1000).tz(timezone)
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
        const exportType = parameters.export_type ?? "diffs"

        switch (exportType) {
            case "totals":
                return this.registerCloseStatementTotalsExport(statement, parameters, skipDescription, shopId)
            case "diffs":
            default:
                return this.registerCloseStatementDiffExport(statement, parameters, skipDescription, shopId)
        }
    }

    private addVoucher(vouchers: any[], amount: number | undefined, vatCode: string | undefined, account: Account, currencyCode: string | undefined, config: Config, negate: boolean = false) {
        if (_.isNil(amount)) {
            return
        }
        if (config.skipZeroAmountTransactions === true && amount === 0) {
            return
        }
        const voucher: any = {
            text: account.description + config.sourceDescription,
            amount: negate ? -amount : amount,
            account: {
                accountNumber: account.account
            },
            currency: {
                code: currencyCode ?? config.currencyCode
            },
            date: config.date
        }
        if (!_.isNil(vatCode)) {
            voucher.vatAccount = {
                vatCode: vatCode
            }
        }
        if (!_.isNil(config.departmentalDistribution)) {
            voucher.departmentalDistribution = config.departmentalDistribution
        }
        vouchers.push(voucher)
        return voucher
    }

    private addGenericVoucher(vouchers: any[], amount: number | undefined, vatCode: string | undefined, account: Account, config: Config, negate: boolean = false) {
        return this.addVoucher(vouchers, amount, vatCode, account, undefined, config, negate)
    }

    private addForeignCurrencyVoucher(vouchers: any[], amount: number | undefined, vatCode: string | undefined, account: Account, currencyCode: string | undefined, foreignCurrencyTotal: number, baseCurrencyTotal: number | undefined, config: Config, negate: boolean = false) {
        const voucher = this.addVoucher(vouchers, amount, vatCode, account, currencyCode, config, negate)
        if (voucher === undefined) {
            return
        }
        // No need adding exchange rates etc. if we are actually counting in base currency
        if (currencyCode === config.currencyCode) {
            return
        }
        if (_.isNil(amount) || amount === 0) {
            return
        }
        if (foreignCurrencyTotal === 0) {
            return
        }
        if (_.isNil(baseCurrencyTotal)) {
            return
        }
        const exchangeRate = baseCurrencyTotal * 100 / foreignCurrencyTotal
        // Round to 6 decimals - and divide by a 100 more since exchange rate is already in pct.
        voucher.baseCurrencyAmount = Math.round(amount * exchangeRate * 1000000) / 100000000
        // Exchange rate must be rounded to 6 decimals
        voucher.exchangeRate = Math.round(exchangeRate * 1000000) / 1000000
    }

    private getReconciliation(statement: any, paymentType: string, currencyCode: string): any | undefined {
        const reconciliations: any[] = statement.reconciliations
        if (_.isNil(reconciliations)) { return undefined }
        return reconciliations.find(r => { return r.payment_type_identifier === paymentType && r.currency_code === currencyCode })
    }

    private registerCloseStatementTotalsExport(statement: any, parameters: any, skipDescription: boolean, shopId: string) {
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

        const skipZeroAmountTransactions: boolean = parameters.skip_zero_amount_transactions ?? false
        const yearString = lookupYear(parameters.fiscal_years, date)

        const journalEntry: any = {}
        journalEntry.accountingYear = { year: yearString }
        journalEntry.journal = { journalNumber: parameters.journal_number }
        const vouchers: any[] = []
        const sourceDesc = skipDescription ? "" : sourceDescription(statement.source) + " statement number: " + statement.sequence_number
        const differenceTaxCode: string | undefined = parameters.difference_tax_code ?? undefined

        let departmentalDistribution: any = undefined
        if (typeof (parameters.shop_map) === "object" && parameters.shop_map[shopId]) {
            const department = parseInt(parameters.shop_map[shopId])
            departmentalDistribution = {
                departmentalDistributionNumber: department,
                type: "department"
            }
        }
        const config: Config = {
            skipZeroAmountTransactions: skipZeroAmountTransactions,
            sourceDescription: sourceDesc,
            departmentalDistribution: departmentalDistribution,
            currencyCode: statement.base_currency_code,
            date: date,
            differenceTaxCode: differenceTaxCode
        }

        // 1. Handle base currency cash specially first
        // 2. Then foreign currency cash
        // 3. Then all other reconciliations
        // 4. Then handle cash.rounding specifically since it is the only payment type that does not have any
        // corresponding reconciliation steps. 

        // 5. Handle sales
        // 6. Handle returns
        // 7. Handle expenses

        // Start with the calculated 'reported' opening float rather than the counted one, in order to have
        // something to add the diff against.
        this.addVoucher(
            vouchers,
            statement.register_summary.cash_total_at_open - (statement.register_summary.cash_diff_at_open ?? 0),
            undefined,
            this.accountLookup("cash", "open"),
            undefined,
            config,
            true
        )

        // Then add the diff from the day before. 
        const comment = statement.register_summary.cash_diff_comment_at_open
        this.addVoucher(
            vouchers,
            statement.register_summary.cash_diff_at_open,
            config.differenceTaxCode,
            this.accountDiffLookup("cash", comment, "open"),
            undefined,
            config,
            true
        )

        const cashReconciliation = this.getReconciliation(statement, "cash", config.currencyCode)
        if (!_.isNil(cashReconciliation)) {

            // We exclude the deposited amount from the counted total
            // so we only report the deposit of the amount into the
            // deposit account
            if (!_.isNil(cashReconciliation.deposited_amount)) {
                const deposited = cashReconciliation.deposited_amount
                const paymentType = cashReconciliation.payment_type_identifier
                this.addVoucher(
                    vouchers,
                    deposited,
                    undefined,
                    this.accountDepositLookup(paymentType),
                    undefined,
                    config
                )
            }

            this.addVoucher(
                vouchers,
                cashReconciliation.counted - (cashReconciliation.deposited_amount ?? 0),
                undefined,
                this.accountLookup("cash", "close"),
                undefined,
                config
            )

            // Finally add the diff
            const counted = cashReconciliation.counted
            const expected = cashReconciliation.total
            const diff = counted - expected
            if (diff !== 0) {
                const comment = statement.comment || ""
                this.addVoucher(
                    vouchers,
                    diff,
                    config.differenceTaxCode,
                    this.accountDiffLookup("cash", comment, "close"),
                    undefined,
                    config,
                    true
                )
            }
        }

        // Handle all foreign currency cash reconciliations
        for (const reconciliation of statement.reconciliations) {
            const paymentType = reconciliation.payment_type_identifier

            if (paymentType !== "cash") {
                continue
            }
            if (reconciliation.currency_code === config.currencyCode) {
                continue
            }
            this.handleReconciliation(vouchers, statement, reconciliation, paymentType, config)
        }

        // All non-cash reconciliations
        for (const reconciliation of statement.reconciliations) {
            const paymentType = reconciliation.payment_type_identifier
            if (paymentType === "cash") {
                continue
            }

            this.handleReconciliation(vouchers, statement, reconciliation, paymentType, config)
        }

        // Handle cash rounding specially since there is no reconciliation of that payment.
        this.handleCashRounding(vouchers, statement, config)

        // Handle sales - including taxes
        // Handle returns - including taxes
        // Handle expenses - including opposite direction taxes
        this.addGenericVouchers(vouchers, statement, config, "sale")
        this.addGenericVouchers(vouchers, statement, config, "return")

        // Look at individual expense codes
        const expenses = statement.register_summary.expenses ?? {}
        if (!_.isNil(expenses.expenses_by_id)) {
            for (const expenseId in expenses.expenses_by_id) {
                const expense = expenses.expenses_by_id[expenseId]
                for (const taxSummary of expense.tax_summaries ?? []) {
                    const amount = (taxSummary.source_amount ?? 0) + (taxSummary.amount ?? 0)
                    const isExpense = true
                    const vatCode = this.lookupVatCode(taxSummary.rate, taxSummary.type, isExpense)
                    this.addGenericVoucher(
                        vouchers,
                        amount,
                        vatCode,
                        this.accountGenericLookup("expense", expenseId),
                        config,
                        true
                    )
                }
            }
        } else {
            this.addGenericVouchers(vouchers, statement, config, "expense")
        }

        journalEntry.entries = { financeVouchers: vouchers.reverse() }

        return journalEntry
    }

    private handleCashRounding(vouchers: any[], statement: any, config: Config) {
        const transactions: any[] = statement.register_summary?.all?.transactions ?? []
        const matchingPaymentType = transactions.find(t => { return t.type === "cash.rounding" })
        if (!_.isNil(matchingPaymentType)) {
            const byCurrencies = matchingPaymentType.totals?.all?.by_currency ?? {}
            for (const currency in byCurrencies) {
                const byCurrency = byCurrencies[currency]
                const total = byCurrency.foreign_currency_total ?? byCurrency.total
                const baseCurrencyTotal = byCurrency.total

                this.addForeignCurrencyVoucher(
                    vouchers,
                    total,
                    config.differenceTaxCode,
                    this.accountDiffLookup("cash", "", "rounding"),
                    currency,
                    total,
                    baseCurrencyTotal,
                    config
                )
            }
        }
    }

    private handleReconciliation(vouchers: any[], statement: any, reconciliation: any, paymentType: string, config: Config) {
        // NOTE: Here be dragons! The reconciliation total is always in
        // the foreign currency, because reconciliations is about counting.
        // We _may_ have a base_currency_total as well (from POS 18.4.0)
        // The totals reported in the transactions are in base currency, with 
        // the possible foreign currency reported seperately

        if (!_.isNil(reconciliation.deposited_amount)) {
            const deposited = reconciliation.deposited_amount
            const paymentType = reconciliation.payment_type_identifier
            this.addForeignCurrencyVoucher(
                vouchers,
                deposited,
                undefined,
                this.accountDepositLookup(paymentType),
                reconciliation.currency_code,
                reconciliation.total,
                reconciliation.base_currency_total,
                config
            )

            // If there are any amounts that are not deposited (not currently the case for foreign currency cash, but could change in the future)
            // then we register them as income.
            const diff = reconciliation.counted - reconciliation.deposited_amount
            if (diff !== 0) {
                this.addForeignCurrencyVoucher(
                    vouchers,
                    diff,
                    config.differenceTaxCode,
                    this.accountLookup(paymentType),
                    reconciliation.currency_code,
                    reconciliation.total,
                    reconciliation.base_currency_total,
                    config
                )
            }
        } else {
            // CARD PAYMENTS ARE NEVER DEPOSITED

            const currencyCode = reconciliation.currency_code
            const total = reconciliation.total
            let remaining = total
            console.log("A - paymentType", paymentType)

            // Look up register_summary/all/transactions/(find type=paymenttype)/by_currency/{currency}
            const transactions: any[] = statement.register_summary?.all?.transactions ?? []
            const matchingPaymentType = transactions.find(t => { return t.type === paymentType })
            if (!_.isNil(matchingPaymentType)) {
                console.log("B - matching paymentType - currency code", currencyCode)
                const byCurrency = matchingPaymentType.totals?.all?.by_currency[currencyCode]
                if (!_.isNil(byCurrency)) {
                    console.log("C - matching currency")

                    const byCardType = byCurrency.by_card_type
                    if (!_.isNil(byCardType)) {
                        console.log("D - has by_card_type")
                        for (const cardType in byCardType) {
                            console.log("E - card type", cardType)
                            const totals = byCardType[cardType]
                            const total = (currencyCode === config.currencyCode) ? (totals?.total ?? 0) : (totals?.foreign_currency_total ?? 0)
                            remaining -= total

                            // voucher per card type
                            this.addForeignCurrencyVoucher(
                                vouchers,
                                total,
                                undefined,
                                this.accountLookup(paymentType, cardType),
                                reconciliation.currency_code,
                                reconciliation.total,
                                reconciliation.base_currency_total,
                                config
                            )
                        }
                    }
                }
            }
            if (Math.abs(remaining) >= 0.01) {
                // voucher for remaining
                this.addForeignCurrencyVoucher(
                    vouchers,
                    remaining,
                    undefined,
                    this.accountLookup(paymentType),
                    reconciliation.currency_code,
                    reconciliation.total,
                    reconciliation.base_currency_total,
                    config
                )
            }
        }
        if (reconciliation.should_be_reconciled && !_.isNil(reconciliation.counted)) {
            const counted = reconciliation.counted
            const expected = reconciliation.total
            const diff = counted - expected
            if (diff !== 0) {
                const paymentType = reconciliation.payment_type_identifier

                const comment = statement.comment ?? ""
                this.addForeignCurrencyVoucher(
                    vouchers,
                    diff,
                    config.differenceTaxCode,
                    this.accountDiffLookup(paymentType, comment, "close"),
                    reconciliation.currency_code,
                    reconciliation.total,
                    reconciliation.base_currency_total,
                    config,
                    true
                )
            }
        }
    }

    private addGenericVouchers(vouchers: any[], statement: any, config: Config, type: "sale" | "return" | "expense") {
        let summaries: any[] = []
        let isExpense = false
        switch (type) {
            case "sale":
                summaries = statement.register_summary.sales?.tax_summaries ?? []
                break
            case "return":
                summaries = statement.register_summary.returns?.tax_summaries ?? []
                break
            case "expense":
                isExpense = true
                summaries = statement.register_summary.expenses?.tax_summaries ?? []
                break
        }
        for (const taxSummary of summaries) {
            const amount = (taxSummary.source_amount ?? 0) + (taxSummary.amount ?? 0)
            const vatCode = this.lookupVatCode(taxSummary.rate, taxSummary.type, isExpense)
            this.addGenericVoucher(
                vouchers,
                amount,
                vatCode,
                this.accountGenericLookup(type),
                config,
                true
            )
        }
    }

    private registerCloseStatementDiffExport(statement: any, parameters: any, skipDescription: boolean, shopId: string) {
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
        const differenceTaxCode: string | undefined = parameters.difference_tax_code ?? undefined

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
                text: paymentTypeAccount.description + sourceDesc,
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
            if (!_.isNil(differenceTaxCode)) {
                voucher2.vatAccount = {
                    vatCode: differenceTaxCode
                }
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
                    if (!_.isNil(differenceTaxCode)) {
                        voucher2.vatAccount = {
                            vatCode: differenceTaxCode
                        }
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
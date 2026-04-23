import { ethers } from "ethers";

export class BaseSwapper {
    constructor(provider, wallet) {
        this.provider = provider;
        this.wallet = wallet;
    }

    /**
     * Mengambil quote dari Relay API
     */
    async getRelayQuote(params) {
        try {
            const response = await fetch("https://api.relay.link/quote", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    user: this.wallet.address,
                    originChainId: 8453, // Base
                    destinationChainId: 8453, // Base
                    originCurrency: params.tokenIn === "native" ? "0x0000000000000000000000000000000000000000" : params.tokenIn,
                    destinationCurrency: params.tokenOut === "native" ? "0x0000000000000000000000000000000000000000" : params.tokenOut,
                    amount: params.amountIn.toString(),
                    tradeType: "EXACT_INPUT",
                    useExternalLiquidity: true,
                    referrer: "relay.link/swap"
                })
            });

            const data = await response.json();
            
            if (data.error || !data.steps) {
                const errorMsg = data.message || "Gagal mengambil quote dari Relay";
                if (errorMsg.includes("no routes found")) {
                    throw new Error("Tidak ada rute ditemukan. Coba naikkan sedikit jumlah (amount) di .env kamu.");
                }
                throw new Error(errorMsg);
            }
            return data;
        } catch (error) {
            throw new Error(`API Relay Error: ${error.message}`);
        }
    }

    /**
     * Menjalankan transaksi swap (mendukung Approval + Swap otomatis)
     */
    async swap(params) {
        const quote = await this.getRelayQuote(params);

        console.log(`   🔄 Memproses ${quote.steps.length} langkah transaksi...`);

        let lastResponse;

        for (const step of quote.steps) {
            console.log(`   🔸 Menjalankan: ${step.description || step.action}`);
            
            for (const item of step.items) {
                // PEMBERSIHAN DATA (Sanitization)
                // Kita buat objek baru hanya dengan properti yang dibutuhkan Ethers v6
                // Hal ini untuk menghindari eror INVALID_ARGUMENT dari data tambahan API Relay
                const txRequest = {
                    to: item.to,
                    data: item.data,
                    value: item.value ? ethers.getBigInt(item.value) : 0n,
                };

                // Opsional: Gunakan gasLimit dari Relay jika ada, atau biarkan kosong agar estimasi otomatis
                if (item.gas) {
                    try {
                        // Tambahkan buffer 20% agar transaksi lebih stabil
                        txRequest.gasLimit = (ethers.getBigInt(item.gas) * 120n) / 100n;
                    } catch (e) {
                        // Jika gagal konversi, biarkan kosong (estimasi otomatis)
                    }
                }

                try {
                    // Kirim transaksi ke network
                    const response = await this.wallet.sendTransaction(txRequest);
                    console.log(`   🔗 Hash: ${response.hash}`);
                    
                    // Tunggu konfirmasi blok sebelum lanjut ke langkah berikutnya
                    const receipt = await response.wait();
                    
                    if (receipt.status === 0) {
                        throw new Error("Transaksi gagal/reverted di blockchain.");
                    }
                    
                    console.log(`   ✅ Langkah selesai.`);
                    lastResponse = response;
                } catch (txError) {
                    console.error(`   ❌ Kesalahan Transaksi: ${txError.reason || txError.message}`);
                    throw txError;
                }
            }
        }
        // Return hash terakhir agar index.js bisa menampilkan Basescan link
        return { tx: lastResponse };
    }

    /**
     * Mengambil info saldo dan detail token
     */
    async getTokenInfo(address) {
        // Cek jika native ETH
        if (address === "native" || address === "0x0000000000000000000000000000000000000000") {
            const balance = await this.provider.getBalance(this.wallet.address);
            return { symbol: "ETH", decimals: 18, balance };
        }

        const abi = [
            "function balanceOf(address) view returns (uint256)", 
            "function decimals() view returns (uint8)", 
            "function symbol() view returns (string)"
        ];

        try {
            const contract = new ethers.Contract(address, abi, this.provider);
            const [balance, decimals, symbol] = await Promise.all([
                contract.balanceOf(this.wallet.address).catch(() => 0n),
                contract.decimals().catch(() => 18),
                contract.symbol().catch(() => "TOKEN")
            ]);
            return { balance, decimals, symbol };
        } catch (error) {
            return { balance: 0n, decimals: 18, symbol: "???" };
        }
    }
}

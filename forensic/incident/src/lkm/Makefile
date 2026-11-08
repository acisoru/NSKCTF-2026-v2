obj-m += em_ksnftc.o
em_ksnftc-y := src/em_ksnftc.o src/em_ksnftc_hooks.o src/em_ksnftc_umh.o src/worker_blob.o
ccflags-y := -I$(src)/include
KDIR ?= /lib/modules/$(KERNELRELEASE)/build

all:
	$(MAKE) -C $(KDIR) M=$(CURDIR) modules

clean:
	$(MAKE) -C $(KDIR) M=$(CURDIR) clean
